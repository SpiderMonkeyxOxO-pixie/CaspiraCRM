// Backend Phase 9 — structured outputs. Each has a JSON Schema sent to the
// provider and a Zod schema the gateway validates the answer against. A
// model's output is untrusted input until it passes validation.
import { z } from "zod";
import { exploreFindingsSchema } from "../../services/ai/schemas.js";
import { SUGGESTED_ACTION_TYPES } from "../catalog.js";

export const GOVERNED_ACTION_TYPES = ["create_follow_up", "schedule_meeting", "assign_owner", "update_expected_close_date", "add_next_action", "create_deal", "request_missing_information"];

const actionProposalSchema = z.object({
  actionType: z.enum(GOVERNED_ACTION_TYPES),
  reason: z.string().min(1).max(1000),
  proposedValues: z.record(z.string(), z.unknown()).default({}),
  supportingFields: z.array(z.string().max(80)).max(20).default([]),
});

export const OUTPUT_SCHEMAS = {
  "explore.findings": {
    zod: exploreFindingsSchema,
    json: {
      type: "object", additionalProperties: false, required: ["findings"],
      properties: {
        findings: {
          type: "array", maxItems: 8,
          items: {
            type: "object", required: ["title", "observation", "citedRecordIds"],
            properties: {
              title: { type: "string" }, observation: { type: "string" }, citedRecordIds: { type: "array", items: { type: "string" } },
              suggestedAction: {
                type: "object", required: ["type", "label", "reason", "affectedRecordId", "affectedRecordType"],
                properties: { type: { type: "string", enum: SUGGESTED_ACTION_TYPES }, label: { type: "string" }, reason: { type: "string" }, affectedRecordId: { type: "string" }, affectedRecordType: { type: "string" } },
              },
            },
          },
        },
      },
    },
  },
  "action.proposal": {
    zod: actionProposalSchema,
    tool: true, // requested as a forced tool call
    json: {
      type: "object", required: ["actionType", "reason"],
      properties: {
        actionType: { type: "string", enum: GOVERNED_ACTION_TYPES },
        reason: { type: "string" },
        proposedValues: { type: "object" },
        supportingFields: { type: "array", items: { type: "string" } },
      },
    },
  },
};

const PREF_KEYS = ["summary_length", "currency_display", "report_style", "default_scope", "preferred_mode"];
const copilotPlan = z.object({
  intent: z.enum(["ask", "briefing", "meeting", "pipeline", "renewal", "data_quality", "daily", "prohibited", "smalltalk"]).catch("ask"),
  toolRequests: z.array(z.object({ tool: z.string().max(60), arguments: z.record(z.string(), z.unknown()).default({}), reason: z.string().max(300).default("") })).max(8).default([]),
  clarification: z.object({ question: z.string().max(300) }).optional().nullable(),
});
const copilotAnswer = z.object({
  answer: z.string().max(6000),
  findings: z.array(z.object({ text: z.string().max(800), citations: z.array(z.string().max(12)).max(10).default([]) })).max(12).default([]),
  missing: z.array(z.string().max(300)).max(10).default([]),
  suggestedActions: z.array(z.object({ tool: z.string().max(60), arguments: z.record(z.string(), z.unknown()).default({}), reason: z.string().max(400).default(""), citations: z.array(z.string().max(12)).max(10).default([]) })).max(3).default([]),
  memoryProposal: z.object({ key: z.enum(PREF_KEYS), value: z.string().max(100), reason: z.string().max(300).default("") }).optional().nullable(),
});
OUTPUT_SCHEMAS["copilot.plan"] = {
  zod: copilotPlan,
  json: { type: "object", required: ["intent", "toolRequests"], properties: { intent: { type: "string" }, toolRequests: { type: "array", items: { type: "object", required: ["tool", "arguments"], properties: { tool: { type: "string" }, arguments: { type: "object" }, reason: { type: "string" } } } }, clarification: { type: "object", properties: { question: { type: "string" } } } } },
};
OUTPUT_SCHEMAS["copilot.answer"] = {
  zod: copilotAnswer,
  json: {
    type: "object", required: ["answer", "findings"],
    properties: {
      answer: { type: "string" }, missing: { type: "array", items: { type: "string" } },
      findings: { type: "array", items: { type: "object", required: ["text", "citations"], properties: { text: { type: "string" }, citations: { type: "array", items: { type: "string" } } } } },
      suggestedActions: { type: "array", items: { type: "object", required: ["tool", "arguments"], properties: { tool: { type: "string" }, arguments: { type: "object" }, reason: { type: "string" }, citations: { type: "array", items: { type: "string" } } } } },
      memoryProposal: { type: "object", properties: { key: { type: "string", enum: PREF_KEYS }, value: { type: "string" }, reason: { type: "string" } } },
    },
  },
};

export const PROPOSE_ACTION_TOOL = {
  name: "propose_action",
  description: "Propose one governed CRM action for a person to review and confirm. Nothing is executed.",
  parameters: OUTPUT_SCHEMAS["action.proposal"].json,
};

export function validateOutput(schemaKey, value) {
  const def = OUTPUT_SCHEMAS[schemaKey];
  if (!def) return { ok: true, value };
  const parsed = def.zod.safeParse(value);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  return { ok: true, value: parsed.data };
}

// A model must never claim to have carried out an action.
const ACTION_CLAIM = /\b(I|we)\s+(have\s+|'ve\s+|just\s+)?(sent|emailed|messaged|deleted|archived|merged|updated|approved|posted|paid|refunded|signed|confirmed|activated|executed)\b/i;
export const claimsAction = (text) => ACTION_CLAIM.test(String(text || ""));
