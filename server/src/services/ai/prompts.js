// Re-declared here (not imported) — matches src/pages/AI/aiTypes.js's
// SUGGESTED_ACTION_TYPES exactly. The backend has no import path into
// frontend code, and this list only needs to stay in sync manually the same
// way aiConfig.js's MODULE_ROUTE_ROLES already mirrors App.jsx by hand.
export const SUGGESTED_ACTION_TYPES = [
  "create_follow_up", "schedule_meeting", "assign_owner", "update_expected_closing_date",
  "add_next_action", "review_duplicate", "create_deal_from_lead", "start_renewal_review",
  "request_missing_information", "open_affected_records",
];

export function buildNarrativeMessages({ executiveSummary, facts }) {
  const system = [
    "You are a business analyst writing a short executive narrative for a CRM dashboard.",
    "You will be given a set of ALREADY-VERIFIED facts, computed deterministically — you must treat every value in them as ground truth.",
    "Rewrite the draft summary as clear, natural, professional prose (3-5 sentences).",
    "You MUST NOT introduce any number, percentage, date, or currency amount that is not present in the facts below.",
    "You MUST NOT change, round differently, or recompute any number that IS present.",
    "If you are unsure whether a detail is supported by the facts, omit it rather than guess.",
    "Do not mention that you are an AI, do not add a greeting, and do not add recommendations beyond what the facts already state.",
  ].join(" ");

  const prompt = [
    `Draft summary (deterministic, may be phrased plainly): ${executiveSummary}`,
    "",
    "Verified facts (JSON):",
    JSON.stringify(facts, null, 2),
    "",
    "Write the improved narrative now.",
  ].join("\n");

  return { system, prompt };
}

export function buildExploreMessages({ records, role, scopeLabel, question }) {
  const system = [
    "You are analyzing a batch of CRM/Sales records for a business user.",
    `The viewer's role is "${role}" and the current scope is "${scopeLabel}" — records outside this scope have already been excluded before reaching you.`,
    "Identify whatever risks, opportunities, or patterns you find genuinely noteworthy. You are not limited to any pre-defined list of findings.",
    "You MUST respond with ONLY valid JSON matching this exact shape, no prose outside the JSON:",
    '{"findings":[{"title":"string","observation":"string","citedRecordIds":["string"],"suggestedAction":{"type":"string","label":"string","reason":"string","affectedRecordId":"string","affectedRecordType":"string"}}]}',
    "`citedRecordIds` must only contain `_id` values that literally appear in the records you were given — never invent an id.",
    `If you propose a "suggestedAction", its "type" must be one of exactly: ${SUGGESTED_ACTION_TYPES.join(", ")}. Omit "suggestedAction" entirely if none of these fit.`,
    "Return at most 8 findings. If you find nothing noteworthy, return an empty findings array — do not invent a finding to fill the response.",
  ].join(" ");

  const prompt = [
    question ? `The user specifically asked: "${question}"` : "The user asked for a general review of this data.",
    "",
    "Records (JSON):",
    JSON.stringify(records, null, 2),
  ].join("\n");

  return { system, prompt };
}
