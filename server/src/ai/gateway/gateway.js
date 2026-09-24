// Backend Phase 9 — the AI gateway. Every AI request in the CRM goes through
// runAi(), in this order:
//
//   1. policy: AI enabled, use case allowed and enabled, user rate limit
//   2. routing: use case → provider + alias → model, on a usable connection
//   3. context: redaction, sanitization, injection flags, size limits, template
//   4. budget: reserve the worst-case estimated cost on every applicable budget
//   5. provider call with deadline, retries for transient errors and an
//      optional fallback when the policy allows that data to go there
//   6. validation: refusal, structured schema, numeric guardrail, action claims
//   7. usage recorded, reservations settled, thresholds checked
//
// Progress events are persisted for the request; streamed draft text is
// only delivered live and is never stored as the final answer. Nothing here
// executes a tool or an action — tool calls are returned for the caller to
// validate, and actions go through the governed action system.
import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { hasGrant } from "../../utils/grants.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { SIMULATOR_LABEL } from "../common/mode.js";
import { aiAudit } from "../common/audit.js";
import { getAiAdapter } from "../adapters/registry.js";
import { NEVER_SENT, classifyField } from "../catalog.js";
import { getAiPolicy, assertAiEnabled, assertProviderAllowedByPolicy, getUseCase, getRouting, resolveAliasModel, getRedactionRules, allowedClassesFor } from "../policy/policyService.js";
import { redact, fitToSize, renderTemplate, sanitizeText, escapeData, detectInjection } from "../context/contextAssembly.js";
import { getPriceFor, maxCostFor, recordUsage, estimateCost, applicableBudgets, reserveBudgets, settleReservations, checkThresholds } from "../usage/usageService.js";
import { apiKeyFor, isAiUsable, whyUnusable, recordAiOutcome, ensureSimulatorConnection } from "../connections/connectionService.js";
import { OUTPUT_SCHEMAS, PROPOSE_ACTION_TOOL, validateOutput, claimsAction } from "./outputSchemas.js";
import { verifyNoNewNumbers } from "../../services/ai/guardrails.js";

const MAX_ATTEMPTS = 3;
const TERMINAL = ["Completed", "Completed with Warnings", "Failed", "Cancelled", "Refused"];

// Live channels (drafts and progress) and cancel handles, per process.
export const aiEvents = new EventEmitter();
aiEvents.setMaxListeners(200);
const running = new Map(); // requestId → AbortController

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt) => Math.min(4000, 400 * 2 ** attempt) + Math.floor(Math.random() * 200);

async function emit(requestId, organizationId, type, data = {}, state) {
  state.seq += 1;
  const row = await prisma.aiRequestEvent.create({ data: { organizationId, requestId, seq: state.seq, type, data } });
  aiEvents.emit(requestId, { seq: row.seq, type, data, at: row.createdAt });
}

export function isTerminal(status) {
  return TERMINAL.includes(status);
}

async function loadTemplate(templateKey) {
  const template = await prisma.aiPromptTemplate.findUnique({ where: { key: templateKey } });
  if (!template) throw new AiError(CATEGORIES.INVALID_REQUEST, `Prompt template ${templateKey} isn't seeded. Run npm run db:seed:ai.`);
  const version = await prisma.aiPromptTemplateVersion.findFirst({ where: { templateId: template.id, status: "Published" }, orderBy: { version: "desc" } });
  if (!version) throw new AiError(CATEGORIES.INVALID_REQUEST, `Prompt template ${templateKey} has no published version.`);
  return version;
}

// Classes present among the fields that survived redaction.
function classesPresent(value) {
  const found = new Set();
  const walk = (v, key) => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
    else if (key) found.add(classifyField(key));
  };
  walk(value, null);
  return found;
}

async function resolveTarget({ organizationId, policy, useCase, providerKey, alias }) {
  const provider = await prisma.aiProvider.findUnique({ where: { key: providerKey } });
  assertProviderAllowedByPolicy(policy, provider);
  let connection;
  if (providerKey === "simulator") connection = await ensureSimulatorConnection(organizationId);
  else connection = await prisma.aiProviderConnection.findFirst({ where: { organizationId, providerKey, status: { not: "Revoked" } }, orderBy: { updatedAt: "desc" } });
  if (!isAiUsable(connection)) throw whyUnusable(connection);
  if (!useCase.allowedAliases.includes(alias)) throw new AiError(CATEGORIES.POLICY, `The ${alias} model alias isn't allowed for ${useCase.label}.`);
  const modelId = await resolveAliasModel(organizationId, providerKey, alias);
  if (!modelId) throw new AiError(CATEGORIES.INVALID_REQUEST, `No ${alias} model is set for ${provider.name}. Choose one in Model aliases.`);
  const verified = connection.verifiedModels || [];
  if (verified.length && !verified.includes(modelId)) throw new AiError(CATEGORIES.INVALID_REQUEST, `${modelId} isn't available to this organization's ${provider.name} key. Reverify the connection or change the alias.`);
  return { provider, connection, modelId, alias };
}

// options:
//   req                      the authenticated request (organizationId, membership)
//   useCaseKey               e.g. "overview.narrative"
//   dataVariables            record data → redacted, wrapped as <data>
//   textVariables            short labels the template uses (sanitized, not data)
//   hiddenFields / hiddenClassifications   what this user may not see
//   stream                   deliver draft text live (when the use case allows it)
//   idempotencyKey           a repeated request returns the earlier one
//   providerKey / alias      explicit choice (evaluations, provider picker)
//   accountingUseCaseKey     usage/budget attribution (evaluations)
//   numericFacts             facts for the numeric guardrail
//   requestId                pre-created request id (asynchronous streaming)
//   finalize(output, validation, refused) → what is stored as the request's
//                            result (e.g. the narrative's deterministic fallback)
export async function runAi(options) {
  const { req, useCaseKey } = options;
  const organizationId = req.organizationId;
  const membershipId = req.membership?.id || null;
  const correlationId = options.correlationId || crypto.randomUUID();
  const state = { seq: 0 };

  const policy = await getAiPolicy(organizationId);
  const useCase = await getUseCase(organizationId, useCaseKey);
  const accountingKey = options.accountingUseCaseKey || useCaseKey;

  // Idempotent submission.
  if (options.idempotencyKey) {
    const earlier = await prisma.aiRequest.findUnique({ where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: options.idempotencyKey } } });
    if (earlier) {
      if (!isTerminal(earlier.status)) throw new AiError(CATEGORIES.INVALID_REQUEST, "This request is already being processed.", { details: { requestId: earlier.id } });
      return { request: earlier, replayed: true, output: earlier.result };
    }
  }

  const request = options.requestId
    ? await prisma.aiRequest.findUnique({ where: { id: options.requestId } })
    : await prisma.aiRequest.create({ data: { organizationId, userId: req.user?.id || null, membershipId, useCaseKey: accountingKey, correlationId, idempotencyKey: options.idempotencyKey || null, status: "Queued" } });
  const controller = new AbortController();
  running.set(request.id, controller);
  const started = Date.now();
  let reservationIds = [];
  let target = null;
  let price = null;

  // Stops between stages once the request is cancelled.
  const checkCancelled = () => { if (controller.signal.aborted) throw new AiError(CATEGORIES.UNKNOWN, "The request was cancelled.", { details: { cancelled: true } }); };
  const finish = async (data) => {
    running.delete(request.id);
    return prisma.aiRequest.update({ where: { id: request.id }, data: { ...data, completedAt: new Date(), durationMs: Date.now() - started } });
  };

  try {
    await emit(request.id, organizationId, "accepted", { useCase: useCase.label }, state);

    // 1. Policy
    assertAiEnabled(policy);
    if ((policy.allowedUseCases || []).length && !policy.allowedUseCases.includes(useCaseKey)) throw new AiError(CATEGORIES.POLICY, `${useCase.label} isn't allowed by your organization's AI policy.`);
    if (!useCase.enabled) throw new AiError(CATEGORIES.POLICY, `${useCase.label} is turned off for this organization.`);
    if (!options.skipPermission && !hasGrant(req, "ai_features", "use")) throw new AiError(CATEGORIES.PERMISSION, "Your role can't use AI features.");
    if (membershipId) {
      const lastHour = await prisma.aiRequest.count({ where: { organizationId, membershipId, createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
      if (lastHour > policy.maxRequestsPerUserPerHour) throw new AiError(CATEGORIES.RATE_LIMITED, `You've reached this organization's limit of ${policy.maxRequestsPerUserPerHour} AI requests per hour.`, { retryAfterMs: 60_000 });
    }
    await emit(request.id, organizationId, "policy", { ok: true }, state);
    checkCancelled();

    // 2. Routing
    const routing = await getRouting(organizationId, useCaseKey);
    const providerKey = options.providerKey || routing.primaryProviderKey;
    if (!providerKey) throw new AiError(CATEGORIES.POLICY, "No AI provider is connected for this use case. Ask an administrator to connect one.");
    const alias = options.alias || (options.providerKey ? useCase.defaultAlias : routing.primaryAlias) || useCase.defaultAlias;
    target = await resolveTarget({ organizationId, policy, useCase, providerKey, alias });
    await emit(request.id, organizationId, "routing", { provider: target.provider.name, alias, mode: target.connection.mode, simulatorLabel: target.connection.mode === "Simulator" ? SIMULATOR_LABEL : null }, state);

    checkCancelled();
    // 3. Context
    const rules = await getRedactionRules(organizationId);
    const red = redact(options.dataVariables || {}, { policy, rules, useCase, providerKey: target.provider.key, hiddenFields: options.hiddenFields, hiddenClassifications: options.hiddenClassifications, salt: organizationId });
    const fitted = fitToSize(red.value, useCase.maxInputChars);
    const textVars = {};
    const textFlags = [];
    for (const [k, v] of Object.entries(options.textVariables || {})) {
      const clean = escapeData(sanitizeText(v ?? "")).slice(0, 2000);
      textVars[k] = clean;
      for (const f of detectInjection(clean)) textFlags.push(`${k}:${f}`);
    }
    const injectionFlags = [...red.injectionFlags, ...textFlags];
    const template = await loadTemplate(options.templateKey || useCase.templateKey);
    const vars = { ...textVars, ...fitted.variables };
    const system = renderTemplate(template.system, textVars);
    const prompt = renderTemplate(template.userTemplate, vars);
    await prisma.aiRequest.update({
      where: { id: request.id },
      data: {
        status: "Running", startedAt: new Date(), connectionId: target.connection.id, providerKey: target.provider.key, modelId: target.modelId, alias, mode: target.connection.mode,
        promptTemplateVersionId: template.id, inputChars: system.length + prompt.length, removedFields: red.removedFields, injectionFlags,
        payload: { system, prompt }, payloadExpiresAt: new Date(Date.now() + policy.retention.requestPayloadDays * 86_400_000),
      },
    });
    await emit(request.id, organizationId, "context", { removedFields: red.removedFields.length, maskedFields: red.maskedFields.length, truncated: fitted.truncated, injectionFlags: injectionFlags.length }, state);
    if (injectionFlags.length) await aiAudit(req, "ai.prompt_injection.detected", "AiRequest", request.id, { after: { useCase: useCaseKey, flags: injectionFlags.slice(0, 20) } });

    checkCancelled();
    // 4. Budget
    price = await getPriceFor(organizationId, target.provider.key, target.modelId);
    const budgets = await applicableBudgets(organizationId, { useCaseKey: accountingKey, membershipId, providerKey: target.provider.key });
    const worstCase = maxCostFor(price, { inputChars: system.length + prompt.length, maxOutputTokens: useCase.maxOutputTokens });
    reservationIds = await reserveBudgets(budgets, worstCase, { requestId: request.id });
    if (reservationIds.length) await prisma.aiRequest.update({ where: { id: request.id }, data: { reservationId: reservationIds[0] } });
    await emit(request.id, organizationId, "budget", { reserved: worstCase, costKnown: worstCase !== null, budgets: budgets.length }, state);

    checkCancelled();
    // 5. Provider call
    const schemaDef = useCase.outputSchema ? OUTPUT_SCHEMAS[useCase.outputSchema] : null;
    const stream = !!options.stream && useCase.streamingAllowed && !schemaDef;
    const call = async (t, attempt) => {
      await emit(request.id, organizationId, "provider", { attempt, provider: t.provider.name }, state);
      const adapter = getAiAdapter(t.provider.key, t.connection.mode);
      const params = {
        apiKey: await apiKeyFor(t.connection), model: t.modelId, system, prompt, maxOutputTokens: useCase.maxOutputTokens,
        stream, onDelta: stream ? (delta) => aiEvents.emit(request.id, { type: "draft", data: { delta }, draft: true }) : undefined,
        providerStorage: policy.providerStorage === true, signal: controller.signal, timeoutMs: useCase.timeoutMs,
        ...(schemaDef && !schemaDef.tool && { outputSchema: { name: useCase.outputSchema, schema: schemaDef.json } }),
        ...(schemaDef?.tool && useCase.toolsAllowed && { tools: [PROPOSE_ACTION_TOOL], toolChoice: PROPOSE_ACTION_TOOL.name }),
      };
      const callStarted = Date.now();
      try {
        const out = await adapter.generate(params);
        await recordAiOutcome(t.connection);
        const p = t === target ? price : await getPriceFor(organizationId, t.provider.key, t.modelId);
        await recordUsage({ organizationId, membershipId, requestId: request.id, useCaseKey: accountingKey, providerKey: t.provider.key, modelId: t.modelId, alias: t.alias, mode: t.connection.mode, usage: out.usage, price: p, outcome: out.refusal ? "Refused" : "Succeeded", durationMs: Date.now() - callStarted, correlationId });
        return { out, cost: estimateCost(p, out.usage) };
      } catch (err) {
        const e = err instanceof AiError ? err : new AiError(CATEGORIES.UNKNOWN, "The AI provider request failed.");
        await recordAiOutcome(t.connection, e);
        await recordUsage({ organizationId, membershipId, requestId: request.id, useCaseKey: accountingKey, providerKey: t.provider.key, modelId: t.modelId, alias: t.alias, mode: t.connection.mode, usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, price: null, outcome: e.details?.cancelled ? "Cancelled" : "Failed", errorCategory: e.category, durationMs: Date.now() - callStarted, correlationId });
        throw e;
      }
    };

    let result = null;
    let lastError = null;
    let attempts = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !result; attempt += 1) {
      attempts = attempt;
      try {
        result = await call(target, attempt);
      } catch (e) {
        lastError = e;
        if (controller.signal.aborted || !e.retryable || attempt === MAX_ATTEMPTS) break;
        const wait = e.category === CATEGORIES.RATE_LIMITED ? e.retryAfterMs || 1000 : backoff(attempt);
        await emit(request.id, organizationId, "retrying", { category: e.category, waitMs: wait }, state);
        await sleep(wait);
      }
    }

    // Fallback: only for provider-side failures, only if configured, allowed
    // by policy, usable, and allowed to receive every class of data present.
    if (!result && lastError && !controller.signal.aborted && [CATEGORIES.PROVIDER_UNAVAILABLE, CATEGORIES.TIMEOUT, CATEGORIES.RATE_LIMITED].includes(lastError.category) && !options.providerKey && routing.fallbackProviderKey) {
      const present = classesPresent(fitted.variables);
      const fallbackClasses = new Set(allowedClassesFor(policy, routing.fallbackProviderKey));
      const blocked = [...present].filter((c) => c !== "Internal" && c !== "Public" && !fallbackClasses.has(c));
      if (blocked.length || [...present].some((c) => NEVER_SENT.includes(c))) {
        await emit(request.id, organizationId, "fallback", { used: false, reason: `The fallback provider may not receive ${blocked.join(", ")} data.` }, state);
      } else {
        try {
          const fb = await resolveTarget({ organizationId, policy, useCase, providerKey: routing.fallbackProviderKey, alias: routing.fallbackAlias || alias });
          await emit(request.id, organizationId, "fallback", { used: true, provider: fb.provider.name }, state);
          result = await call(fb, attempts + 1);
          target = fb;
        } catch (e) { lastError = e; }
      }
    }
    if (!result) throw lastError || new AiError(CATEGORIES.UNKNOWN, "The AI request failed.");

    // 6. Validation
    await emit(request.id, organizationId, "validating", {}, state);
    const { out, cost } = result;
    await settleReservations(reservationIds, cost);
    reservationIds = [];
    await checkThresholds(budgets);
    const validation = { ok: true, warnings: [] };
    let output;
    let status = "Completed";
    if (out.refusal) {
      await emit(request.id, organizationId, "completed", { status: "Refused" }, state);
      const done = await finish({ status: "Refused", errorCategory: CATEGORIES.CONTENT_REFUSED, safeError: "The AI model declined this request.", ...(options.finalize && { result: options.finalize(null, null, true) }), outputChars: (out.text || "").length, providerRequestId: out.providerRequestId, attempts, validation: { ok: false, refused: true } });
      return { request: done, refused: true, output: null, provider: providerInfo(target), usage: out.usage };
    }
    if (schemaDef) {
      const raw = schemaDef.tool ? out.toolCalls.find((c) => c.name === PROPOSE_ACTION_TOOL.name)?.arguments : out.json;
      const checked = validateOutput(useCase.outputSchema, raw);
      if (!checked.ok) {
        await aiAudit(req, "ai.output.validation_failed", "AiRequest", request.id, { result: "Failure", after: { useCase: useCaseKey, issues: checked.issues || ["unparseable"] } });
        throw new AiError(CATEGORIES.CONTENT_REFUSED, "The AI response didn't match the expected format, so it was discarded.", { details: { issues: checked.issues || ["The response wasn't valid JSON."] } });
      }
      output = checked.value;
    } else {
      output = { text: String(out.text || "").trim() };
      if (useCase.numericGuardrail && options.numericFacts) {
        const { verified, unverifiedNumbers } = verifyNoNewNumbers(output.text, options.numericFacts);
        if (!verified) { validation.warnings.push("new_numbers"); validation.unverifiedNumbers = unverifiedNumbers.slice(0, 10); }
      }
      if (claimsAction(output.text)) validation.warnings.push("action_claim");
      if (detectInjection(output.text).length) validation.warnings.push("suspicious_output");
      if (!output.text) validation.warnings.push("empty");
    }
    if (validation.warnings.length) { validation.ok = false; status = "Completed with Warnings"; }
    const done = await finish({ status, result: options.finalize ? options.finalize(output, validation, false) : output, outputChars: JSON.stringify(output).length, providerRequestId: out.providerRequestId, attempts, validation });
    await emit(request.id, organizationId, "completed", { status }, state);
    return { request: done, output, validation, provider: providerInfo(target), usage: out.usage, estimatedCost: cost, truncated: fitted.truncated };
  } catch (err) {
    const e = err instanceof AiError ? err : new AiError(CATEGORIES.UNKNOWN, "The AI request failed.");
    if (reservationIds.length) await settleReservations(reservationIds, null).catch(() => {});
    const cancelled = controller.signal.aborted || e.details?.cancelled;
    const status = cancelled ? "Cancelled" : [CATEGORIES.POLICY, CATEGORIES.BUDGET, CATEGORIES.PERMISSION].includes(e.category) || (e.category === CATEGORIES.RATE_LIMITED && !target) ? "Refused" : "Failed";
    await finish({ status, errorCategory: cancelled ? null : e.category, safeError: cancelled ? "Cancelled by the user." : e.message }).catch(() => {});
    await emit(request.id, organizationId, cancelled ? "cancelled" : "failed", cancelled ? {} : { category: e.category, message: e.message }, state).catch(() => {});
    if (status === "Refused" && !cancelled) await aiAudit(req, "ai.request.refused", "AiRequest", request.id, { result: "Failure", reason: e.message, after: { useCase: useCaseKey, category: e.category } });
    if (cancelled) throw Object.assign(new AiError(CATEGORIES.UNKNOWN, "The request was cancelled."), { cancelled: true, requestId: request.id });
    e.requestId = request.id;
    throw e;
  } finally {
    running.delete(request.id);
  }
}

const providerInfo = (t) => (t ? { id: t.provider.key, label: t.provider.name, model: t.modelId, alias: t.alias, mode: t.connection.mode, simulatorLabel: t.connection.mode === "Simulator" ? SIMULATOR_LABEL : null } : null);

// Cancels a running request (this process) and marks it Cancelled.
export async function cancelAiRequest(organizationId, requestId) {
  const request = await prisma.aiRequest.findFirst({ where: { id: requestId, organizationId } });
  if (!request) return null;
  if (isTerminal(request.status)) return request;
  const handle = running.get(request.id);
  if (handle) {
    handle.abort(new Error("cancelled"));
    for (let i = 0; i < 50 && running.has(request.id); i += 1) await sleep(20);
  }
  const fresh = await prisma.aiRequest.findUnique({ where: { id: request.id } });
  if (!isTerminal(fresh.status)) return prisma.aiRequest.update({ where: { id: request.id }, data: { status: "Cancelled", safeError: "Cancelled by the user.", completedAt: new Date() } });
  return fresh;
}

export const _running = running; // tests
