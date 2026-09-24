// Backend Phase 9 — AI providers, connections, models, aliases, use cases,
// routing, policy and privacy.
import prisma from "../../lib/prisma.js";
import { guard, notFound, versionConflict, checkVersion, invalid } from "./common.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { aiAudit } from "../common/audit.js";
import { aiMode, SIMULATOR_LABEL } from "../common/mode.js";
import { ALIASES, CLASSIFICATIONS, NEVER_SENT } from "../catalog.js";
import {
  getAiPolicy, aiPolicyChanges, getRedactionRules, REDACTION_ACTIONS, getUseCase, listUseCases, useCaseChanges,
  listAliases, getRouting, assertProviderAllowedByPolicy,
} from "../policy/policyService.js";
import {
  serializeAiConnection, loadAiConnection, createAiConnection, verifyAiConnection, rotateAiKey, revokeAiConnection, describeKey, ensureSimulatorConnection,
} from "../connections/connectionService.js";
import { redact, fitToSize } from "../context/contextAssembly.js";

const serializeProvider = (p, extra = {}) => ({
  _id: p.key, key: p.key, name: p.name, description: p.description, authType: p.authType, capabilities: p.capabilities, availability: p.availability,
  availabilityReason: p.availabilityReason, dataRetentionNote: p.dataRetentionNote, docsUrl: p.docsUrl, dataPolicyUrl: p.dataPolicyUrl,
  adapterVersion: p.adapterVersion, enabledByDefault: p.enabledByDefault, active: p.active, simulatorLabel: p.key === "simulator" ? SIMULATOR_LABEL : null, ...extra,
});

// ---- Providers and connections ------------------------------------------------------

export const listProviders = guard(async (req, res) => {
  if (aiMode() === "simulator") await ensureSimulatorConnection(req.organizationId);
  const [providers, connections, policy] = await Promise.all([
    prisma.aiProvider.findMany({ orderBy: { name: "asc" } }),
    prisma.aiProviderConnection.findMany({ where: { organizationId: req.organizationId } }),
    getAiPolicy(req.organizationId),
  ]);
  const visible = providers.filter((p) => p.key !== "simulator" || aiMode() === "simulator");
  res.json({
    providers: visible.map((p) => {
      const c = connections.find((x) => x.providerKey === p.key && x.status !== "Revoked");
      let allowed = true;
      try { assertProviderAllowedByPolicy(policy, p); } catch { allowed = false; }
      const status = c ? c.status : p.availability === "Adapter" ? "Not Configured" : "Unavailable";
      // id/label/configured keep the AI Overview provider picker working.
      return serializeProvider(p, { id: p.key, label: p.name, configured: allowed && ["Connected", "Connected with Warnings"].includes(status), connectionStatus: status, connectionId: c?.publicId || null, allowedByPolicy: allowed });
    }),
    mode: aiMode(), simulatorLabel: aiMode() === "simulator" ? SIMULATOR_LABEL : null,
  });
});

export const getProvider = guard(async (req, res) => {
  const p = await prisma.aiProvider.findUnique({ where: { key: req.params.key } });
  if (!p || (p.key === "simulator" && aiMode() !== "simulator")) return notFound(res, "AI provider");
  const models = await prisma.aiModel.findMany({ where: { providerKey: p.key }, orderBy: { displayName: "asc" } });
  res.json({ provider: serializeProvider(p, { models: models.map((m) => ({ modelId: m.modelId, displayName: m.displayName, capabilities: m.capabilities, contextWindow: m.contextWindow, maxOutputTokens: m.maxOutputTokens, status: m.status })) }) });
});

export const listConnections = guard(async (req, res) => {
  if (aiMode() === "simulator") await ensureSimulatorConnection(req.organizationId);
  const rows = await prisma.aiProviderConnection.findMany({ where: { organizationId: req.organizationId, ...(req.query.includeRevoked === "true" ? {} : { status: { not: "Revoked" } }) }, orderBy: { createdAt: "asc" } });
  res.json({ connections: rows.map((c) => serializeAiConnection(c)), mode: aiMode(), simulatorLabel: aiMode() === "simulator" ? SIMULATOR_LABEL : null });
});

export const getConnection = guard(async (req, res) => {
  const c = await loadAiConnection(req, req.params.id);
  if (!c) return notFound(res, "Connection");
  res.json({ connection: serializeAiConnection(c, { credentials: await describeKey(c.id) }) });
});

export const createConnection = guard(async (req, res) => {
  const provider = await prisma.aiProvider.findUnique({ where: { key: String(req.body.providerKey || "") } });
  if (!provider) throw invalid("Unknown AI provider.");
  assertProviderAllowedByPolicy(await getAiPolicy(req.organizationId), provider);
  let connection = await createAiConnection(req, provider, { name: req.body.name, apiKey: req.body.apiKey });
  await aiAudit(req, "ai.connection.created", "AiProviderConnection", connection.id, { after: { providerKey: provider.key, mode: connection.mode, keyStored: !!req.body.apiKey } });
  let verification = null;
  if (connection.status === "Ready to Verify") {
    try {
      connection = await verifyAiConnection(connection);
      await aiAudit(req, connection.verifiedAt ? "ai.connection.verified" : "ai.connection.verification_failed", "AiProviderConnection", connection.id, { result: connection.verifiedAt ? "Success" : "Failure", after: { status: connection.status } });
    } catch (err) {
      verification = { ok: false, category: err.category, message: err.message };
      connection = await prisma.aiProviderConnection.findUnique({ where: { id: connection.id } });
      await aiAudit(req, "ai.connection.verification_failed", "AiProviderConnection", connection.id, { result: "Failure", reason: err.message });
    }
  }
  res.status(201).json({ connection: serializeAiConnection(connection), verification, note: "The API key is stored encrypted and will never be shown again." });
});

export const updateConnection = guard(async (req, res) => {
  const c = await loadAiConnection(req, req.params.id);
  if (!c) return notFound(res, "Connection");
  if (!checkVersion(req.body, c)) return versionConflict(res, "connection");
  if (!("name" in req.body)) throw invalid("Only the name can be changed here. Use rotate-key, verify, disable or enable for the rest.");
  const updated = await prisma.aiProviderConnection.update({ where: { id: c.id }, data: { name: String(req.body.name || c.name).slice(0, 120), version: { increment: 1 } } });
  await aiAudit(req, "ai.connection.updated", "AiProviderConnection", c.id, { before: { name: c.name }, after: { name: updated.name } });
  res.json({ connection: serializeAiConnection(updated) });
});

export const verifyConnection = guard(async (req, res) => {
  const c = await loadAiConnection(req, req.params.id);
  if (!c) return notFound(res, "Connection");
  try {
    const updated = await verifyAiConnection(c);
    await aiAudit(req, updated.verifiedAt ? "ai.connection.verified" : "ai.connection.verification_failed", "AiProviderConnection", c.id, { result: updated.verifiedAt ? "Success" : "Failure", after: { status: updated.status, models: (updated.verifiedModels || []).length } });
    res.json({ connection: serializeAiConnection(updated) });
  } catch (err) {
    await aiAudit(req, "ai.connection.verification_failed", "AiProviderConnection", c.id, { result: "Failure", reason: err.message });
    throw err;
  }
});

export const rotateKey = guard(async (req, res) => {
  const c = await loadAiConnection(req, req.params.id);
  if (!c) return notFound(res, "Connection");
  if (c.status === "Revoked") throw invalid("This connection was removed. Create it again.");
  let updated = await rotateAiKey(c, req.body.apiKey);
  await aiAudit(req, "ai.connection.key_rotated", "AiProviderConnection", c.id);
  try { updated = await verifyAiConnection(updated); } catch { updated = await prisma.aiProviderConnection.findUnique({ where: { id: c.id } }); }
  res.json({ connection: serializeAiConnection(updated), note: "The new key is stored encrypted; the previous one was superseded." });
});

export const disableConnection = guard(async (req, res) => {
  const c = await loadAiConnection(req, req.params.id);
  if (!c) return notFound(res, "Connection");
  if (c.status === "Revoked") throw invalid("This connection was removed.");
  const updated = await prisma.aiProviderConnection.update({ where: { id: c.id }, data: { status: "Disabled", disabledAt: new Date(), version: { increment: 1 } } });
  await aiAudit(req, "ai.connection.disabled", "AiProviderConnection", c.id, { reason: req.body.reason });
  res.json({ connection: serializeAiConnection(updated) });
});

export const enableConnection = guard(async (req, res) => {
  const c = await loadAiConnection(req, req.params.id);
  if (!c) return notFound(res, "Connection");
  if (c.status !== "Disabled") throw invalid("The connection isn't disabled.");
  let updated = await prisma.aiProviderConnection.update({ where: { id: c.id }, data: { status: "Ready to Verify", disabledAt: null, version: { increment: 1 } } });
  await aiAudit(req, "ai.connection.enabled", "AiProviderConnection", c.id);
  try { updated = await verifyAiConnection(updated); } catch { updated = await prisma.aiProviderConnection.findUnique({ where: { id: c.id } }); }
  res.json({ connection: serializeAiConnection(updated) });
});

export const deleteConnection = guard(async (req, res) => {
  const c = await loadAiConnection(req, req.params.id);
  if (!c) return notFound(res, "Connection");
  const updated = await revokeAiConnection(c);
  await aiAudit(req, "ai.connection.deleted", "AiProviderConnection", c.id, { reason: req.body?.reason });
  res.json({ connection: serializeAiConnection(updated), note: "The stored key was revoked. Remove it at the provider too if it's no longer needed." });
});

// ---- Models, aliases, use cases, routing ----------------------------------------------------

export const listModels = guard(async (req, res) => {
  const [models, connections] = await Promise.all([
    prisma.aiModel.findMany({ orderBy: [{ providerKey: "asc" }, { displayName: "asc" }] }),
    prisma.aiProviderConnection.findMany({ where: { organizationId: req.organizationId, status: { not: "Revoked" } } }),
  ]);
  const verified = new Map(connections.map((c) => [c.providerKey, new Set(c.verifiedModels || [])]));
  res.json({ models: models.filter((m) => m.providerKey !== "simulator" || aiMode() === "simulator").map((m) => ({ ...m, _id: m.id, availableToOrganization: verified.get(m.providerKey)?.has(m.modelId) ?? false })) });
});

export const listModelAliases = guard(async (req, res) => {
  res.json({ aliases: await listAliases(req.organizationId), allowedAliases: ALIASES });
});

export const setModelAlias = guard(async (req, res) => {
  const alias = req.params.alias;
  if (!ALIASES.includes(alias)) throw invalid(`Aliases: ${ALIASES.join(", ")}.`);
  const providerKey = String(req.body.providerKey || "");
  const modelId = String(req.body.modelId || "").slice(0, 120);
  const provider = await prisma.aiProvider.findUnique({ where: { key: providerKey } });
  if (!provider || provider.availability !== "Adapter") throw invalid("Choose a provider with an adapter.");
  const connection = await prisma.aiProviderConnection.findFirst({ where: { organizationId: req.organizationId, providerKey, status: { not: "Revoked" } } });
  const inCatalog = await prisma.aiModel.findUnique({ where: { providerKey_modelId: { providerKey, modelId } } });
  const verified = (connection?.verifiedModels || []).includes(modelId);
  if (!inCatalog && !verified) throw invalid("Choose a model from the catalog or one the organization's key has verified.");
  const existing = await prisma.aiModelAlias.findUnique({ where: { organizationId_alias_providerKey: { organizationId: req.organizationId, alias, providerKey } } });
  if (!checkVersion(req.body, existing)) return versionConflict(res, "alias");
  const row = existing
    ? await prisma.aiModelAlias.update({ where: { id: existing.id }, data: { modelId, version: { increment: 1 }, updatedByMembershipId: req.membership?.id || null } })
    : await prisma.aiModelAlias.create({ data: { organizationId: req.organizationId, alias, providerKey, modelId, updatedByMembershipId: req.membership?.id || null } });
  await aiAudit(req, "ai.alias.changed", "AiModelAlias", row.id, { before: existing ? { modelId: existing.modelId } : null, after: { alias, providerKey, modelId } });
  res.json({ alias: { alias, providerKey, modelId, version: row.version, verifiedForKey: verified, persisted: true } });
});

export const listUseCasesHandler = guard(async (req, res) => {
  res.json({ useCases: await listUseCases(req.organizationId) });
});

export const updateUseCase = guard(async (req, res) => {
  const current = await getUseCase(req.organizationId, req.params.key);
  if (!checkVersion(req.body, current)) return versionConflict(res, "use case");
  const data = useCaseChanges(current, req.body);
  const base = { enabled: current.enabled, allowedAliases: current.allowedAliases, maxInputChars: current.maxInputChars, maxOutputTokens: current.maxOutputTokens, allowedClassifications: current.allowedClassifications, toolsAllowed: current.toolsAllowed, streamingAllowed: current.streamingAllowed };
  await prisma.aiUseCase.upsert({
    where: { organizationId_key: { organizationId: req.organizationId, key: current.key } },
    update: { ...data, version: { increment: 1 }, updatedByMembershipId: req.membership?.id || null },
    create: { organizationId: req.organizationId, key: current.key, ...base, ...data, updatedByMembershipId: req.membership?.id || null },
  });
  await aiAudit(req, "ai.use_case.changed", "AiUseCase", current.key, { before: base, after: data });
  res.json({ useCase: await getUseCase(req.organizationId, current.key) });
});

export const listRouting = guard(async (req, res) => {
  const useCases = await listUseCases(req.organizationId);
  res.json({ routingPolicies: await Promise.all(useCases.map(async (u) => ({ useCaseKey: u.key, label: u.label, ...(await getRouting(req.organizationId, u.key)) }))) });
});

export const setRouting = guard(async (req, res) => {
  const useCase = await getUseCase(req.organizationId, req.params.useCase);
  const policy = await getAiPolicy(req.organizationId);
  const check = async (key) => {
    const p = await prisma.aiProvider.findUnique({ where: { key } });
    assertProviderAllowedByPolicy(policy, p);
  };
  const b = req.body || {};
  if (!b.primaryProviderKey || !b.primaryAlias) throw invalid("primaryProviderKey and primaryAlias are required.");
  await check(b.primaryProviderKey);
  if (!useCase.allowedAliases.includes(b.primaryAlias)) throw invalid(`${b.primaryAlias} isn't an allowed alias for this use case.`);
  if (b.fallbackProviderKey) {
    if (b.fallbackProviderKey === b.primaryProviderKey) throw invalid("The fallback must be a different provider.");
    if (b.fallbackProviderKey === "simulator" && aiMode() !== "simulator") throw new AiError(CATEGORIES.POLICY, "The simulator can't be a fallback in live mode.");
    await check(b.fallbackProviderKey);
    if (b.fallbackAlias && !useCase.allowedAliases.includes(b.fallbackAlias)) throw invalid(`${b.fallbackAlias} isn't an allowed alias for this use case.`);
  }
  const existing = await prisma.aiRoutingPolicy.findUnique({ where: { organizationId_useCaseKey: { organizationId: req.organizationId, useCaseKey: useCase.key } } });
  if (!checkVersion(b, existing)) return versionConflict(res, "routing policy");
  const data = { primaryProviderKey: b.primaryProviderKey, primaryAlias: b.primaryAlias, fallbackProviderKey: b.fallbackProviderKey || null, fallbackAlias: b.fallbackProviderKey ? b.fallbackAlias || b.primaryAlias : null, updatedByMembershipId: req.membership?.id || null };
  const row = existing
    ? await prisma.aiRoutingPolicy.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } })
    : await prisma.aiRoutingPolicy.create({ data: { organizationId: req.organizationId, useCaseKey: useCase.key, ...data } });
  await aiAudit(req, "ai.routing.changed", "AiRoutingPolicy", row.id, { before: existing ? { primary: `${existing.primaryProviderKey}/${existing.primaryAlias}`, fallback: existing.fallbackProviderKey } : null, after: { primary: `${row.primaryProviderKey}/${row.primaryAlias}`, fallback: row.fallbackProviderKey } });
  res.json({ routingPolicy: { ...row, persisted: true } });
});

// ---- Policy and privacy ----------------------------------------------------------------------

export const getPolicy = guard(async (req, res) => {
  res.json({ policy: await getAiPolicy(req.organizationId), classifications: CLASSIFICATIONS, neverSent: NEVER_SENT });
});

export const updatePolicy = guard(async (req, res) => {
  const current = await getAiPolicy(req.organizationId);
  if (!checkVersion(req.body, current)) return versionConflict(res, "AI policy");
  const data = aiPolicyChanges(req.body);
  if (data.retention) data.retention = { ...current.retention, ...data.retention };
  const row = await prisma.aiPolicy.upsert({
    where: { organizationId: req.organizationId },
    update: { ...data, version: { increment: 1 }, updatedByMembershipId: req.membership?.id || null },
    create: { organizationId: req.organizationId, ...data, updatedByMembershipId: req.membership?.id || null },
  });
  const before = Object.fromEntries(Object.keys(data).map((k) => [k, current[k]]));
  await aiAudit(req, "ai.policy.changed", "AiPolicy", row.id, { before, after: data });
  res.json({ policy: await getAiPolicy(req.organizationId) });
});

export const getRedaction = guard(async (req, res) => {
  res.json({ rules: await getRedactionRules(req.organizationId), actions: REDACTION_ACTIONS });
});

export const putRedaction = guard(async (req, res) => {
  const rules = Array.isArray(req.body.rules) ? req.body.rules : [];
  if (!rules.length) throw invalid("Send rules: [{ classification, action, reason }].");
  const changed = [];
  for (const r of rules) {
    if (!CLASSIFICATIONS.includes(r.classification)) throw invalid(`Unknown classification ${r.classification}.`);
    if (!REDACTION_ACTIONS.includes(r.action)) throw invalid(`Action must be one of ${REDACTION_ACTIONS.join(", ")}.`);
    if (NEVER_SENT.includes(r.classification) && r.action !== "Remove") throw new AiError(CATEGORIES.POLICY, `${r.classification} data is always removed.`);
    const existing = await prisma.aiRedactionRule.findUnique({ where: { organizationId_classification: { organizationId: req.organizationId, classification: r.classification } } });
    if (existing) await prisma.aiRedactionRule.update({ where: { id: existing.id }, data: { action: r.action, reason: r.reason ? String(r.reason).slice(0, 300) : null, version: { increment: 1 }, updatedByMembershipId: req.membership?.id || null } });
    else await prisma.aiRedactionRule.create({ data: { organizationId: req.organizationId, classification: r.classification, action: r.action, reason: r.reason ? String(r.reason).slice(0, 300) : null, updatedByMembershipId: req.membership?.id || null } });
    changed.push({ classification: r.classification, from: existing?.action || null, to: r.action });
  }
  await aiAudit(req, "ai.redaction.changed", "AiRedactionRule", null, { after: { changed } });
  res.json({ rules: await getRedactionRules(req.organizationId) });
});

// Shows what a use case would send for the given sample: kept, masked and
// removed fields. Nothing is sent to a provider.
export const contextPreview = guard(async (req, res) => {
  const useCase = await getUseCase(req.organizationId, String(req.body.useCaseKey || "overview.explore"));
  const policy = await getAiPolicy(req.organizationId);
  const routing = await getRouting(req.organizationId, useCase.key);
  const providerKey = String(req.body.providerKey || routing.primaryProviderKey || "simulator");
  const sample = req.body.sample && typeof req.body.sample === "object" ? req.body.sample : {};
  const out = redact(sample, { policy, rules: await getRedactionRules(req.organizationId), useCase, providerKey, salt: req.organizationId });
  let size;
  try { size = fitToSize(out.value, useCase.maxInputChars); } catch (err) { size = { error: err.message }; }
  res.json({ preview: { useCaseKey: useCase.key, providerKey, sent: size.variables ?? out.value, removedFields: out.removedFields, maskedFields: out.maskedFields, injectionFlags: out.injectionFlags, truncated: !!size.truncated, chars: size.chars ?? null, limit: useCase.maxInputChars, sizeError: size.error || null, note: "Nothing was sent to any provider." } });
});
