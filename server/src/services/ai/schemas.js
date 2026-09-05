import { z } from "zod";
import { SUGGESTED_ACTION_TYPES } from "./prompts.js";

export const narrativeRequestSchema = z.object({
  provider: z.string().optional(),
  executiveSummary: z.string().min(1),
  facts: z.record(z.string(), z.unknown()),
});

const recordArray = z.array(z.record(z.string(), z.unknown())).optional().default([]);

export const exploreRequestSchema = z.object({
  provider: z.string().optional(),
  question: z.string().optional(),
  scopeLabel: z.string().min(1),
  records: z.object({
    deals: recordArray, companies: recordArray, contacts: recordArray, activities: recordArray,
    quotes: recordArray, orders: recordArray, contracts: recordArray, leads: recordArray,
  }),
});

// Validates the MODEL's own JSON output before it's ever returned to the
// frontend — treated as untrusted input, same as any other user-controlled
// payload, since it's the model's free-form response, not our own code.
const suggestedActionSchema = z.object({
  type: z.enum(SUGGESTED_ACTION_TYPES),
  label: z.string().min(1),
  reason: z.string().min(1),
  affectedRecordId: z.string().min(1),
  affectedRecordType: z.string().min(1),
}).optional();

export const exploreFindingsSchema = z.object({
  findings: z.array(z.object({
    title: z.string().min(1),
    observation: z.string().min(1),
    citedRecordIds: z.array(z.string()).default([]),
    suggestedAction: suggestedActionSchema,
  })).max(8).default([]),
});
