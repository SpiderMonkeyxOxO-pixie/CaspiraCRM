import { describe, it, expect } from "vitest";
import { authorizeToolCall, ToolDenied, toolCatalogForModel, PROPOSAL_TOOLS } from "./tools/registry.js";
import { validateMemoryValue } from "./memory.js";
import { computeConfidence, toCitation } from "./citations.js";
import { chunkText } from "./retrieval/indexer.js";
import { simulatorEmbed, tokenize, SIM_DIMENSIONS } from "./retrieval/embeddings.js";
import { detectProhibited } from "./orchestrator.js";
import { EvidenceSet, shapeRecord } from "./evidence.js";
import { validateOutput } from "../gateway/outputSchemas.js";
import { WORKFLOWS, workflowChecksum } from "./workflows.js";

const role = (grants) => ({ role: { permissionGrants: Object.entries(grants).map(([moduleId, actions]) => ({ moduleId, actions })) } });
const req = (grants) => ({ organizationId: "org-1", membership: { id: "m-1", roles: [role(grants)] } });
const STD = { ai_copilot: ["use"], ai_copilot_tools: ["view"], deals: ["view"], companies: ["view"], sales_reports: ["view"], invoices: ["view"] };

describe("tool registry authorization", () => {
  it("refuses tools that aren't allowlisted", () => {
    expect(() => authorizeToolCall(req(STD), "delete_record", {})).toThrow(ToolDenied);
    try { authorizeToolCall(req(STD), "run_sql", {}); } catch (e) { expect(e.reason).toBe("not_allowlisted"); }
  });
  it("needs the Copilot tools grant and the module grant", () => {
    expect(() => authorizeToolCall(req({ deals: ["view"] }), "search_deals", {})).toThrow(/Copilot data tools/);
    try { authorizeToolCall(req({ ai_copilot_tools: ["view"] }), "search_deals", {}); } catch (e) { expect(e.reason).toBe("no_module_grant"); }
  });
  it("strips identity fields the model supplies", () => {
    const { input } = authorizeToolCall(req(STD), "search_deals", { organizationId: "other", ownerMembershipId: "x", teamId: "t", query: "acme" });
    expect(input).not.toHaveProperty("organizationId");
    expect(input).not.toHaveProperty("ownerMembershipId");
    expect(input).not.toHaveProperty("teamId");
    expect(input.query).toBe("acme");
  });
  it("validates arguments with the tool's schema", () => {
    expect(() => authorizeToolCall(req(STD), "search_deals", { limit: 500 })).toThrow(/Invalid arguments/);
  });
  it("sensitive tools need the sensitive grant and a confirmation", () => {
    try { authorizeToolCall(req(STD), "search_invoices", {}); } catch (e) { expect(e.reason).toBe("no_sensitive_grant"); }
    const ok = authorizeToolCall(req({ ...STD, ai_copilot_tools: ["view", "view_sensitive_fields"] }), "search_invoices", {});
    expect(ok.confirmation).toBeTruthy();
  });
  it("organization-wide pipeline metrics need confirmation; own scope doesn't", () => {
    expect(authorizeToolCall(req(STD), "get_pipeline_metrics", {}).confirmation).toBeFalsy();
    expect(authorizeToolCall(req(STD), "get_pipeline_metrics", { scope: "organization" }).confirmation).toBeTruthy();
  });
  it("the model's tool catalog only lists tools the user may use", () => {
    const names = toolCatalogForModel(req({ ai_copilot_tools: ["view"], deals: ["view"] })).read.map((t) => t.name);
    expect(names).toContain("search_deals");
    expect(names).not.toContain("search_support_tickets");
  });
  it("proposal tools never include destructive actions", () => {
    for (const [name, def] of Object.entries(PROPOSAL_TOOLS)) {
      expect(name).toMatch(/^propose_/);
      expect(["delete", "send_email", "process_payment", "change_permissions"]).not.toContain(def.actionType);
    }
  });
});

describe("memory validation", () => {
  it("accepts allowlisted preferences only", () => {
    expect(validateMemoryValue("summary_length", "Short")).toBe("short");
    expect(validateMemoryValue("currency_display", "USD symbol")).toBe("USD symbol");
    expect(() => validateMemoryValue("favourite_customer", "Acme")).toThrow(/Only these preferences/);
    expect(() => validateMemoryValue("summary_length", "gigantic")).toThrow(/must be one of/);
  });
  it("refuses personal, financial, credential and HR content", () => {
    expect(() => validateMemoryValue("report_style", "email jane@example.com")).toThrow(/email address/);
    expect(() => validateMemoryValue("report_style", "call +1 555 123 4567")).toThrow(/phone/);
    expect(() => validateMemoryValue("report_style", "budget 48,000")).toThrow(/financial/);
    expect(() => validateMemoryValue("report_style", "my password is x")).toThrow(/authentication/);
    expect(() => validateMemoryValue("report_style", "salary review")).toThrow(/HR or health/);
  });
});

describe("confidence and citations", () => {
  const base = { evidenceCount: 5, findingsKept: 3, removed: 0, stale: false, truncated: false, restricted: false, deterministic: false, semanticOnly: false, providerIssue: false };
  it("is computed from facts, never from the model", () => {
    expect(computeConfidence(base)).toBe("High Confidence");
    expect(computeConfidence({ ...base, removed: 1 })).toBe("Medium Confidence");
    expect(computeConfidence({ ...base, removed: 2, truncated: true })).toBe("Low Confidence");
    expect(computeConfidence({ ...base, evidenceCount: 0 })).toBe("Insufficient Data");
    expect(computeConfidence({ ...base, findingsKept: 0 })).toBe("Insufficient Data");
    expect(computeConfidence({ ...base, evidenceCount: 1 })).toBe("Medium Confidence");
  });
  it("a citation carries the record, not the model's words", () => {
    const c = toCitation("E1", { recordType: "Deal", recordId: "d1", label: "Acme renewal", route: "/crm/deals/d1", updatedAt: "2026-09-01T00:00:00Z", sourceVersion: "3", method: "exact", masked: [] });
    expect(c).toMatchObject({ citationKey: "E1", recordType: "Deal", recordId: "d1", route: "/crm/deals/d1", retrievalMethod: "exact", status: "Valid", masked: false });
  });
});

describe("evidence", () => {
  it("hands out stable handles and deduplicates records", () => {
    const e = new EvidenceSet();
    const a = e.add({ recordType: "Deal", recordId: "1", label: "A" }, "exact");
    const b = e.add({ recordType: "Deal", recordId: "1", label: "A" }, "structured");
    const c = e.add({ recordType: "Company", recordId: "1", label: "C" }, "exact");
    expect(a.handle).toBe("E1");
    expect(b).toBe(a);
    expect(c.handle).toBe("E2");
    expect(e.forModel()[0]).not.toHaveProperty("route");
  });
  it("shapes records to primitives and drops internal fields", () => {
    const r = shapeRecord("Deal", { _id: "d1", name: "Acme", stage: "Proposal", value: null, internalNotes: "secret", organizationId: "o", lineItems: [1], owner: { _id: "m", name: "Ann" }, updatedAt: new Date("2026-09-01") });
    expect(r.fields).not.toHaveProperty("internalNotes");
    expect(r.fields).not.toHaveProperty("organizationId");
    expect(r.fields).not.toHaveProperty("lineItems");
    expect(r.fields.owner).toEqual({ id: "m", name: "Ann" });
    expect(r.masked).toContain("value");
    expect(r.route).toBe("/crm/deals/d1");
  });
  it("never passes secret-bearing fields or credential values to the model (found by the Phase 11 zero-tolerance suite)", () => {
    const r = shapeRecord("Deal", { _id: "d2", name: "Acme", apiKey: "sk-live-abc", webhookSecret: "whsec_1", note: "use sk-live-1234567890abcdef1234 to log in" });
    expect(r.fields).not.toHaveProperty("apiKey");
    expect(r.fields).not.toHaveProperty("webhookSecret");
    expect(JSON.stringify(r.fields)).not.toContain("sk-live");
  });
});

describe("indexing and embeddings", () => {
  it("chunks with overlap and masks contact details", () => {
    const text = `Call jane@example.com or +1 555 123 4567. ${"word ".repeat(400)}`;
    const chunks = chunkText([{ label: "Body", text }]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].text).not.toContain("jane@example.com");
    expect(chunks[0].text).not.toMatch(/555 123 4567/);
    expect(chunks[0].sectionLabel).toBe("Body");
  });
  it("simulator embeddings are deterministic, normalized and similarity-preserving", () => {
    const a = simulatorEmbed("reset a customer password in the portal");
    expect(a).toHaveLength(SIM_DIMENSIONS);
    expect(simulatorEmbed("reset a customer password in the portal")).toEqual(a);
    const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 3);
    const cos = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0);
    expect(cos(a, simulatorEmbed("how to reset customer password"))).toBeGreaterThan(cos(a, simulatorEmbed("quarterly shipping invoice freight")));
    expect(tokenize("The Password, reset!")).toEqual(["password", "reset"]);
  });
});

describe("prohibited requests", () => {
  it("detects actions the Copilot must never take", () => {
    for (const t of ["delete this lead", "send an email to the customer", "refund the order", "approve the quote", "change their permission", "export all contacts"]) expect(detectProhibited(t)).toBeTruthy();
    for (const t of ["review my pipeline", "summarize Acme", "which deals need follow-up?"]) expect(detectProhibited(t)).toBeNull();
  });
});

describe("structured outputs", () => {
  it("plan and answer schemas are enforced", () => {
    expect(validateOutput("copilot.plan", { intent: "ask", toolRequests: [{ tool: "search_deals", arguments: {}, reason: "x" }] }).ok).toBe(true);
    expect(validateOutput("copilot.plan", { intent: "ask", toolRequests: "all" }).ok).toBe(false);
    expect(validateOutput("copilot.answer", { answer: "a", findings: [{ text: "t", citations: ["E1"] }], missing: [], suggestedActions: [] }).ok).toBe(true);
    expect(validateOutput("copilot.answer", { answer: "a", findings: "everything is fine" }).ok).toBe(false);
  });
});

describe("workflows", () => {
  it("are declarative, bounded and checksummed", () => {
    expect(Object.keys(WORKFLOWS)).toEqual(expect.arrayContaining(["company_briefing", "meeting_preparation", "pipeline_review", "renewal_review", "data_quality_review", "daily_preparation"]));
    for (const w of Object.values(WORKFLOWS)) {
      expect(w.steps.length).toBeLessThanOrEqual(14);
      for (const s of w.steps) if (s.type === "tool") expect(s.tool).not.toMatch(/^propose_|delete|send/);
      expect(workflowChecksum(w)).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
