// Provider-neutral frontend AI contracts for the AI Intelligence Center.
//
// These are plain JS factory functions (this codebase has no TypeScript
// build step) rather than interfaces, but they serve the same purpose: one
// place that defines the exact shape every AI surface reads and writes, so
// nothing downstream (cards, drawers, tests) has to guess a field name.
//
// Provider-neutral means: no field here is named after or shaped around
// Claude or OpenAI specifically. A future backend AI gateway should be able
// to return JSON matching AIAnalysisResponse and the UI would not need to
// change. Today, the only implementation is aiInsightEngine.js — a
// deterministic, frontend-only calculator — never a real model call.

export const AI_PROVIDER_STATUS = "Built-in rules";

/** @returns {{status: string, isRealProvider: boolean, description: string}} AIProviderStatus */
export function createProviderStatus() {
  return {
    status: AI_PROVIDER_STATUS,
    isRealProvider: false,
    description:
      "Insights are worked out by built-in rules from the records you can see. Nothing is sent to an AI provider.",
  };
}

export const CONFIDENCE_LEVELS = ["High Confidence", "Medium Confidence", "Low Confidence", "Insufficient Data"];

/**
 * @param {"High Confidence"|"Medium Confidence"|"Low Confidence"|"Insufficient Data"} level
 * @param {string} explanation - Why this level was chosen, in plain language, never a decimal score.
 * @returns {{level: string, explanation: string}} AIConfidence
 */
export function createConfidence(level, explanation) {
  return { level, explanation };
}

/**
 * @param {{ latestRecordUpdatedAt: string|null, generatedAt: string, recordCount: number }} params
 * @returns {{ latestRecordUpdatedAt: string|null, generatedAt: string, recordCount: number, isStale: boolean }} AIDataFreshness
 */
export function createDataFreshness({ latestRecordUpdatedAt, generatedAt, recordCount }) {
  return { latestRecordUpdatedAt: latestRecordUpdatedAt || null, generatedAt, recordCount, isStale: false };
}

/**
 * A single piece of evidence backing an insight. Every evidence reference
 * points at a real shared-fixture record — never a fabricated one — and
 * `route` is only populated when the viewing role is authorized to open it
 * (see aiConfig.canOpenModuleRoute). When not authorized, `route` is null
 * and the UI must render plain text instead of a link.
 * @returns {object} AIEvidenceReference
 */
export function createEvidenceReference({
  recordType, recordId, recordLabel, supportingField, supportingValue, date = null, explanation, route = null,
}) {
  return { recordType, recordId, recordLabel, supportingField, supportingValue, date, explanation, route };
}

export const SUGGESTED_ACTION_TYPES = [
  "create_follow_up", "schedule_meeting", "assign_owner", "update_expected_closing_date",
  "add_next_action", "review_duplicate", "create_deal_from_lead", "start_renewal_review",
  "request_missing_information", "open_affected_records",
];

// Actions in this list must always show a human-approval banner in the
// action preview, even for roles that are otherwise allowed to confirm
// suggestions — the AI must never appear to execute these on its own.
export const SENSITIVE_ACTION_TYPES = ["review_duplicate", "start_renewal_review"];

/** @returns {object} AISuggestedAction */
export function createSuggestedAction({
  id, type, label, reason, affectedRecordId, affectedRecordType,
  proposedValues = {}, currentValues = {}, requiredApprover = "The record owner or their manager",
  requiredPermission = null, potentialImpact = null,
}) {
  return {
    id, type, label, reason, affectedRecordId, affectedRecordType,
    proposedValues, currentValues, requiredApprover, requiredPermission, potentialImpact,
    requiresHumanApproval: true, // every suggested action requires confirmation — never auto-applied
  };
}

export const INSIGHT_PRIORITIES = ["Critical", "High", "Medium", "Low", "Informational"];
export const INSIGHT_MODULES = ["sales", "activities", "data-quality", "contracts"];
export const FEEDBACK_STATES = ["helpful", "not_helpful", "incorrect"];
export const FEEDBACK_REASONS = [
  "Incorrect data", "Missing context", "Recommendation not useful", "Already resolved", "Duplicate insight", "Other",
];

/** @returns {object} AIInsight */
export function createInsight({
  id, type, module, title, summary, explanation, priority, confidence,
  affectedRecordIds = [], evidence = [], suggestedActions = [], dataRange = null, createdAt,
}) {
  return {
    id, type, module, title, summary, explanation, priority, confidence,
    affectedRecordIds, evidence, suggestedActions, dataRange, createdAt,
    feedback: null, // { state, reason? } — session-only, set via aiSlice
    dismissed: false,
  };
}

/** @returns {object} AIAnalysisRequest */
export function createAnalysisRequest({
  userId, role, scope, organization = "Caspira CRM", department = null, team = null,
  dateRange, modules = INSIGHT_MODULES, filters = {}, analysisType = "overview",
}) {
  return { userId, role, scope, organization, department, team, dateRange, modules, filters, analysisType };
}

/** @returns {object} AIAnalysisResponse */
export function createAnalysisResponse({
  analysisId, executiveSummary, insights, risks, opportunities, suggestedActions,
  evidence, confidence, dataDate, limitations, generatedAt, providerStatus = createProviderStatus(),
}) {
  return {
    analysisId, executiveSummary, insights, risks, opportunities, suggestedActions,
    evidence, confidence, dataDate, limitations, generatedAt, providerStatus,
  };
}

/** @returns {object} AIFeedback */
export function createFeedback(state, reason = null) {
  return { state, reason };
}
