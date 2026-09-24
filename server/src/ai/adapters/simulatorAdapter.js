// Backend Phase 9 — the AI Provider Simulator. Deterministic, in-process,
// credential-free and labelled everywhere it appears. It only sees what a
// real provider would see (the system text and the prompt) and never
// reaches the network.
//
// Behaviour switches for tests and evaluations, written in the prompt:
//   [sim:refuse]        the model refuses
//   [sim:timeout]       never answers (the gateway's deadline or a cancel ends it)
//   [sim:invalid-json]  structured output that doesn't parse
//   [sim:rate-limit]    429 with Retry-After
//   [sim:error]         503 provider unavailable
// and programmatic controls (simulatorControls) for queued failures.
import { AiError, CATEGORIES } from "../common/errors.js";
import { SIMULATOR_LABEL } from "../common/mode.js";
import { completeAiAdapter, parseJsonText } from "./contract.js";
import { AI_MODELS } from "../catalog.js";
import { detectInjection } from "../context/contextAssembly.js";

export const SIM_MODELS = [
  { modelId: "sim-fast", displayName: "Simulator Fast" },
  { modelId: "sim-balanced", displayName: "Simulator Balanced" },
  { modelId: "sim-deep", displayName: "Simulator Deep" },
  { modelId: "sim-structured", displayName: "Simulator Structured" },
];

const controls = { queued: [], rateLimitRetryAfterSec: 2, delayMs: 0, calls: 0 };
export const simulatorControls = {
  fail(...kinds) { controls.queued.push(...kinds); },
  setDelay(ms) { controls.delayMs = ms; },
  reset() { controls.queued = []; controls.delayMs = 0; controls.calls = 0; controls.rateLimitRetryAfterSec = 2; },
  get calls() { return controls.calls; },
};

const tokens = (s) => Math.ceil(String(s || "").length / 4);
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new AiError(CATEGORIES.UNKNOWN, "The request was cancelled.", { details: { cancelled: true } })); return; }
  const t = setTimeout(resolve, ms);
  signal?.addEventListener?.("abort", () => { clearTimeout(t); reject(new AiError(CATEGORIES.UNKNOWN, "The request was cancelled.", { details: { cancelled: true } })); }, { once: true });
});

function failure(kind) {
  if (kind === "rate-limit") return new AiError(CATEGORIES.RATE_LIMITED, "The AI provider is rate limiting this organization.", { status: 429, retryAfterMs: controls.rateLimitRetryAfterSec * 1000 });
  if (kind === "auth") return new AiError(CATEGORIES.AUTHENTICATION, "The AI provider rejected the organization's API key. Update or reverify the key.", { status: 401 });
  if (kind === "error") return new AiError(CATEGORIES.PROVIDER_UNAVAILABLE, "The AI provider is temporarily unavailable.", { status: 503 });
  return new AiError(CATEGORIES.UNKNOWN, "The AI provider request failed.");
}

// Data blocks the gateway wrapped in <data> … </data>.
function dataBlocks(prompt) {
  return [...String(prompt).matchAll(/<data>([\s\S]*?)<\/data>/g)].map((m) => m[1]);
}
function recordsIn(prompt) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") { if (v._id) out.push(v); else Object.values(v).forEach(walk); }
  };
  for (const block of dataBlocks(prompt)) walk(parseJsonText(block));
  return out;
}
const label = (r) => r.name || r.title || r.subject || r.companyName || r._id;

function exploreFindings(prompt) {
  const records = recordsIn(prompt).slice(0, 3);
  return {
    findings: records.map((r, i) => ({
      title: `Review ${label(r)}`,
      observation: [r.stage && `stage ${r.stage}`, r.status && `status ${r.status}`, r.expectedCloseDate && `expected close ${r.expectedCloseDate}`].filter(Boolean).join(", ") || "Selected for review by the simulator.",
      citedRecordIds: [String(r._id)],
      ...(i === 0 && { suggestedAction: { type: "create_follow_up", label: `Follow up on ${label(r)}`, reason: "The simulator suggests a follow-up for the first record.", affectedRecordId: String(r._id), affectedRecordType: r.stage ? "Deal" : "Record" } }),
    })),
  };
}

function actionProposal(prompt) {
  const [record] = recordsIn(prompt);
  if (!record) return { actionType: "request_missing_information", reason: "No record data was supplied.", proposedValues: { subject: "Provide the record details" }, supportingFields: [] };
  if (!record.nextAction) return { actionType: "add_next_action", reason: "The record has no next action.", proposedValues: { nextAction: "Agree the next step with the customer" }, supportingFields: ["nextAction"] };
  if (record.expectedCloseDate && new Date(record.expectedCloseDate) < new Date()) {
    return { actionType: "update_expected_close_date", reason: "The expected close date has passed.", proposedValues: { expectedCloseDate: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10) }, supportingFields: ["expectedCloseDate"] };
  }
  return { actionType: "create_follow_up", reason: "Keep the record moving with a follow-up.", proposedValues: { subject: `Follow up: ${label(record)}` }, supportingFields: ["stage"] };
}

// ---- Copilot (Phase 10) --------------------------------------------------
const requestLine = (prompt) => (String(prompt).match(/User request: (.*)/) || [])[1] || "";
const blockAfter = (prompt, heading) => { const i = String(prompt).indexOf(heading); if (i < 0) return null; const m = String(prompt).slice(i).match(/<data>([\s\S]*?)<\/data>/); return m ? parseJsonText(m[1]) ?? m[1] : null; };

// Deterministic planning from the user's words.
function copilotPlan(prompt) {
  const q = requestLine(prompt);
  const s = q.toLowerCase();
  if (q.includes("[sim:bad-tool]")) return { intent: "ask", toolRequests: [{ tool: "delete_record", arguments: { id: "x" }, reason: "test" }] };
  if (q.includes("[sim:org-inject]")) return { intent: "ask", toolRequests: [{ tool: "search_deals", arguments: { organizationId: "other-org", ownerMembershipId: "someone", query: "" }, reason: "test" }] };
  if (q.includes("[sim:repeat]")) return { intent: "ask", toolRequests: Array.from({ length: 5 }, () => ({ tool: "search_deals", arguments: {}, reason: "repeat" })) };
  if (/\b(delete|archive|merge|send (an )?(email|sms|message)|approve|activate|refund|pay |change permission|sign )/.test(s)) return { intent: "prohibited", toolRequests: [] };
  const requests = [];
  const ctx = blockAfter(prompt, "Record context:");
  const ctxRecord = Array.isArray(ctx) ? ctx[0] : null;
  if (ctxRecord?.recordType === "Company") requests.push({ tool: "get_company", arguments: { id: ctxRecord.recordId }, reason: "Record in context" }, { tool: "search_deals", arguments: { companyId: ctxRecord.recordId }, reason: "Deals for this company" });
  if (ctxRecord?.recordType === "Deal") requests.push({ tool: "get_deal", arguments: { id: ctxRecord.recordId }, reason: "Record in context" });
  if (/pipeline|forecast|weighted/.test(s)) requests.push({ tool: "get_pipeline_metrics", arguments: {}, reason: "Deterministic pipeline totals" });
  if (/overdue|attention|today|my day|follow-?up/.test(s)) requests.push({ tool: "get_overdue_activities", arguments: { mine: true }, reason: "Overdue activities" }, { tool: "search_deals", arguments: { passedExpectedClose: true, mine: true }, reason: "Deals past their close date" });
  if (/lead/.test(s)) requests.push({ tool: "search_leads", arguments: { limit: 10 }, reason: "Leads" });
  if (/ticket|support/.test(s)) requests.push({ tool: "search_support_tickets", arguments: { open: true }, reason: "Open tickets" });
  if (/renewal|contract|expir/.test(s)) requests.push({ tool: "search_contracts", arguments: { expiringWithinDays: 90 }, reason: "Contracts expiring soon" });
  if (/invoice|collection|overdue payment/.test(s)) requests.push({ tool: "search_invoices", arguments: {}, reason: "Invoices" });
  if (/knowledge|article|how (do|to)|policy/.test(s)) requests.push({ tool: "search_knowledge_base", arguments: { query: q.replace(/[^\w\s]/g, " ").trim().slice(0, 80) || "help" }, reason: "Knowledge Base" });
  const company = q.match(/(?:company|about|summari[sz]e|brief(?:ing)? (?:on|for)?)\s+([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*)*)/);
  if (company && !ctxRecord) requests.push({ tool: "search_companies", arguments: { query: company[1] }, reason: "Named company" });
  if (!requests.length) requests.push({ tool: "search_deals", arguments: { status: "Open", limit: 10 }, reason: "General CRM question" });
  const intent = /pipeline/.test(s) ? "pipeline" : /renewal/.test(s) ? "renewal" : /today|my day/.test(s) ? "daily" : "ask";
  return { intent, toolRequests: requests.slice(0, 6) };
}

// Deterministic answer from evidence handles only.
function copilotAnswer(prompt) {
  const q = requestLine(prompt);
  const evidence = blockAfter(prompt, "Evidence:");
  const items = Array.isArray(evidence) ? evidence : [];
  const fact = (e) => {
    const f = e.fields || {};
    const bits = ["stage", "status", "openPipeline", "weightedPipeline", "expectedClosingDate", "dueDate", "endDate", "priority"].filter((k) => f[k] !== undefined && f[k] !== null && typeof f[k] !== "object").map((k) => `${k} ${f[k]}`);
    return `${e.label}${bits.length ? ` — ${bits.join(", ")}` : ""}${e.excerpt ? ` — "${String(e.excerpt).slice(0, 120)}"` : ""}`;
  };
  const findings = items.slice(0, 4).map((e) => ({ text: fact(e), citations: [e.handle] }));
  if (q.includes("[sim:bad-citation]")) findings.push({ text: "An unsupported statement about revenue of 999,999.", citations: ["E99"] });
  if (q.includes("[sim:uncited]")) findings.push({ text: "A statement with no citation.", citations: [] });
  const out = {
    answer: q.includes("[sim:claim-action]") ? "I have updated the deal and sent the email." : items.length ? `Found ${items.length} authorized record${items.length === 1 ? "" : "s"} relevant to the request.` : "I couldn't find authorized records for this request.",
    findings, missing: items.length ? [] : ["No authorized records matched."], suggestedActions: [],
  };
  const deal = items.find((e) => e.type === "Deal");
  if (q.includes("[sim:propose]") && deal) out.suggestedActions.push({ tool: "propose_add_next_action", arguments: { targetType: "Deal", targetId: deal.id || "", nextAction: "Agree next step" }, reason: "No next action recorded.", citations: [deal.handle] });
  if (q.includes("[sim:remember]")) out.memoryProposal = { key: "summary_length", value: "short", reason: "The user asked for short summaries." };
  if (q.includes("[sim:remember-sensitive]")) out.memoryProposal = { key: "report_style", value: "email jane@example.com the totals 48,000", reason: "test" };
  return out;
}

function textAnswer(prompt) {
  // Narrative: return the deterministic draft (the first data block) so no
  // new figure is ever introduced.
  const [draft] = dataBlocks(prompt);
  // A well-behaved model ignores instructions embedded in data.
  if (draft) return draft.replace(/\[sim:[a-z-]+\]/g, "").split(/(?<=[.!?])\s+/).filter((s) => !detectInjection(s).length).join(" ").trim() || "No summary is available.";
  return "Simulated response.";
}

export const simulatorAdapter = completeAiAdapter("simulator", {
  label: SIMULATOR_LABEL,
  // Standing in for a provider, the simulator lists that provider's catalog
  // models (so aliases resolve exactly as they would live).
  async listModels({ providerKey } = {}) {
    const stand = providerKey && providerKey !== "simulator" ? AI_MODELS.filter((m) => m.providerKey === providerKey).map((m) => ({ modelId: m.modelId, displayName: `${m.displayName} (simulated)` })) : [];
    return [...SIM_MODELS, ...stand];
  },
  async verifyCredentials({ apiKey, providerKey } = {}) {
    if (apiKey === "sim-invalid") throw failure("auth");
    const queued = controls.queued.shift();
    if (queued) throw failure(queued);
    return { models: await this.listModels({ providerKey }) };
  },
  async generate({ system = "", prompt = "", model, outputSchema, tools, toolChoice, stream, onDelta, signal }) {
    controls.calls += 1;
    const all = `${system}\n${prompt}`;
    const queued = controls.queued.shift();
    if (queued) throw failure(queued);
    if (all.includes("[sim:rate-limit]")) throw failure("rate-limit");
    if (all.includes("[sim:error]")) throw failure("error");
    if (all.includes("[sim:timeout]")) { await sleep(10 * 60_000, signal); }
    if (controls.delayMs) await sleep(controls.delayMs, signal);
    const usage = { inputTokens: tokens(all), outputTokens: 0, cachedTokens: 0 };
    const base = { providerRequestId: `sim_req_${controls.calls}`, model: model || "sim-balanced", toolCalls: [], refusal: false, finishReason: "stop" };

    if (all.includes("[sim:refuse]")) {
      const text = "I can't help with that request.";
      return { ...base, text, refusal: true, finishReason: "refusal", usage: { ...usage, outputTokens: tokens(text) } };
    }
    const schemaName = outputSchema?.name || toolChoice || null;
    if (schemaName) {
      const invalid = all.includes("[sim:invalid-json]");
      const json = schemaName === "explore.findings" ? exploreFindings(prompt) : schemaName === "copilot.plan" ? copilotPlan(prompt) : schemaName === "copilot.answer" ? copilotAnswer(prompt) : actionProposal(prompt);
      const text = invalid ? "{\"findings\": [ this is not json" : JSON.stringify(json);
      if (tools?.some((t) => t.name === toolChoice) && !outputSchema) {
        return { ...base, text: "", toolCalls: invalid ? [{ name: toolChoice, arguments: { broken: true } }] : [{ name: toolChoice, arguments: json }], finishReason: "tool_use", usage: { ...usage, outputTokens: tokens(text) } };
      }
      return { ...base, text, json: invalid ? undefined : json, usage: { ...usage, outputTokens: tokens(text) } };
    }
    const text = textAnswer(prompt);
    if (stream) {
      for (const word of text.split(/(\s+)/)) {
        if (signal?.aborted) break;
        onDelta?.(word);
        await sleep(2, signal);
      }
    }
    return { ...base, text, usage: { ...usage, outputTokens: tokens(text) } };
  },
  normalizeUsage: (u) => u,
});
