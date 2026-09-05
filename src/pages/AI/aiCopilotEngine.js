// The Copilot's "understanding" is deterministic keyword-intent matching
// against a fixed list of supported questions — never free-form NLP, never
// a real model call. Every answer is built from the same aiSelectors.js
// functions and the same scopeSharedData()/evidence() helpers the Overview
// analysis uses, so a Copilot answer and an Overview insight about the same
// thing always agree — there is only one calculation for each fact, asked
// two different ways.
import {
  createInsight, createEvidenceReference, createSuggestedAction, createConfidence, AI_PROVIDER_STATUS,
} from "./aiTypes";
import { scopeSharedData, evidence, lastActivityFns, moneyFor } from "./aiInsightEngine";
import {
  computeOpenPipeline, computeWeightedPipeline, computeAtRiskAndStaleDeals, computeHighValueAtRiskDeals,
  computeOverdueActivities, computeOverdueFollowUps, computeDataQualityIssues, computeQualifiedLeadsWithoutDeals,
  computeContractsExpiringSoon, computeContractsRenewalDue, computeLeadConversionRate, computeLeadTotals,
  computeDealInactivity, formatByCurrency,
} from "./aiSelectors";

export { AI_PROVIDER_STATUS };

// ---------------------------------------------------------------------------
// Suggested prompts shown as quick-start chips — also doubles as the "what
// can I ask" reference, so the UI and the fallback message can never drift
// out of sync with what's actually supported.
// ---------------------------------------------------------------------------
export const SUGGESTED_PROMPTS = [
  "Which deals need attention?",
  "What's my open pipeline worth?",
  "Show me data quality issues",
  "What's overdue?",
  "Any opportunities I'm missing?",
  "Which contracts are expiring?",
  "How's lead conversion looking?",
];

function now() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Intent handlers — each returns { text, insight } where `insight` is a real
// AIInsight (or null for a purely conversational reply) so the chat can
// reuse AiEvidenceDrawer / AiActionPreviewModal exactly as the Overview does.
// ---------------------------------------------------------------------------
function handleAtRiskDeals(scoped, role) {
  const { dealLastActivityAt } = lastActivityFns(scoped.activities, scoped.companies);
  const atRisk = computeAtRiskAndStaleDeals(scoped.deals, dealLastActivityAt);
  if (atRisk.length === 0) {
    return { text: "No open Deals in your current scope have a risk reason right now — no missing next action, no overdue close date, no inactivity flag.", insight: null };
  }
  const highValue = computeHighValueAtRiskDeals(scoped.deals, dealLastActivityAt);
  const top = [...atRisk].sort((a, b) => (b.deal.value || 0) - (a.deal.value || 0)).slice(0, 5);
  const totalValue = formatByCurrency(Object.fromEntries(
    Object.entries(atRisk.reduce((acc, x) => { const c = x.deal.currency || "USD"; acc[c] = (acc[c] || 0) + (x.deal.value || 0); return acc; }, {}))
  ));
  const text = `${atRisk.length} open Deal${atRisk.length === 1 ? "" : "s"} worth ${moneyFor(role, totalValue)} ${atRisk.length === 1 ? "has" : "have"} a risk flag — ${highValue.count} of those are above the average open Deal size. Here are the top ${top.length} by value.`;
  return {
    text,
    insight: createInsight({
      id: `copilot-at-risk-${Date.now()}`, type: "at_risk_deals", module: "sales",
      title: "Deals needing attention", summary: text,
      explanation: "Combines every open Deal's risk reasons (no next action, no recent activity, overdue close date, expired proposal, missing primary contact, repeated stage re-entry) into one list.",
      priority: highValue.count > 0 ? "Critical" : "High",
      confidence: createConfidence("High Confidence", "Each risk reason is a direct check against an explicit Deal field."),
      affectedRecordIds: top.map((x) => x.deal._id),
      evidence: top.map((x) => evidence({
        recordType: "Deal", record: x.deal, label: x.deal.name, field: "Risk reasons", value: x.reasons.join("; "),
        explanation: "At least one risk condition is currently true for this Deal.", role,
      })),
      suggestedActions: top.slice(0, 1).map((x) => createSuggestedAction({
        id: `${x.deal._id}-copilot-follow-up`, type: "create_follow_up", label: "Create a follow-up",
        reason: "Highest-value at-risk Deal in this scope.", affectedRecordId: x.deal._id, affectedRecordType: "Deal",
        requiredApprover: "Deal owner",
      })),
      dataRange: "Current pipeline", createdAt: now(),
    }),
  };
}

function handlePipelineValue(scoped, role) {
  const openPipeline = computeOpenPipeline(scoped.deals);
  const weighted = computeWeightedPipeline(scoped.deals);
  const inactivity = computeDealInactivity(scoped.deals, lastActivityFns(scoped.activities, scoped.companies).dealLastActivityAt, 14);
  const pipelineText = moneyFor(role, formatByCurrency(openPipeline.valueByCurrency));
  const weightedText = moneyFor(role, formatByCurrency(weighted.valueByCurrency));
  const text = openPipeline.count === 0
    ? "There are no open Deals in your current scope."
    : `Open pipeline is ${pipelineText} across ${openPipeline.count} Deal${openPipeline.count === 1 ? "" : "s"} (${weightedText} weighted by stage probability). ${inactivity.count} of those have had no activity in the last 14 days.`;
  return {
    text,
    insight: openPipeline.count === 0 ? null : createInsight({
      id: `copilot-pipeline-${Date.now()}`, type: "pipeline_value", module: "sales",
      title: "Open pipeline value", summary: text,
      explanation: "Sums the value field of every open Deal in scope; weighted value additionally multiplies by each Deal's stage probability.",
      priority: "Informational",
      confidence: createConfidence("High Confidence", "Direct sum of explicit Deal value fields, grouped by currency."),
      affectedRecordIds: openPipeline.deals.map((d) => d._id), evidence: [], suggestedActions: [],
      dataRange: "Current pipeline", createdAt: now(),
    }),
  };
}

function handleDataQuality(scoped) {
  const dq = computeDataQualityIssues({ leads: scoped.leads, contacts: scoped.contacts, companies: scoped.companies, deals: scoped.deals });
  if (dq.total === 0) {
    return { text: "No data-quality issues were detected in your current scope — no missing contact info, no orphaned Contacts, no duplicate-record candidates.", insight: null };
  }
  const parts = [
    dq.leadsNoContact.count > 0 && `${dq.leadsNoContact.count} Lead${dq.leadsNoContact.count === 1 ? "" : "s"} missing contact info`,
    dq.contactsNoCompany.count > 0 && `${dq.contactsNoCompany.count} Contact${dq.contactsNoCompany.count === 1 ? "" : "s"} without a Company`,
    dq.companiesNoPrimary.count > 0 && `${dq.companiesNoPrimary.count} Compan${dq.companiesNoPrimary.count === 1 ? "y" : "ies"} without a primary Contact`,
    dq.duplicateRisk.count > 0 && `${dq.duplicateRisk.count} candidate duplicate group${dq.duplicateRisk.count === 1 ? "" : "s"}`,
    dq.dealsMissingClosingDate.count > 0 && `${dq.dealsMissingClosingDate.count} open Deal${dq.dealsMissingClosingDate.count === 1 ? "" : "s"} missing an expected closing date`,
  ].filter(Boolean);
  const text = `${dq.total} data-quality issue${dq.total === 1 ? "" : "s"} found: ${parts.join(", ")}.`;
  return {
    text,
    insight: createInsight({
      id: `copilot-data-quality-${Date.now()}`, type: "data_quality_summary", module: "data-quality",
      title: "Data quality summary", summary: text,
      explanation: "Tallies missing contact info, orphaned records, missing primary Contacts, duplicate-record candidates and missing closing dates across Leads, Contacts, Companies and Deals.",
      priority: dq.total >= 5 ? "High" : "Medium",
      confidence: createConfidence("High Confidence", "Every category checks an explicit field or an established duplicate-matching routine — see the completed Duplicate Management workspace for full detail on that part."),
      affectedRecordIds: [], evidence: dq.duplicateRisk.count > 0 ? [createEvidenceReference({
        recordType: "Duplicate Group", recordId: "duplicates", recordLabel: `${dq.duplicateRisk.count} candidate group(s)`,
        supportingField: "Match confidence", supportingValue: "High/Medium", explanation: "See the Duplicate Management workspace for full comparison.",
        route: "/crm/duplicates",
      })] : [],
      suggestedActions: [], dataRange: "Current records", createdAt: now(),
    }),
  };
}

function handleOverdue(scoped, role) {
  const overdueActivities = computeOverdueActivities(scoped.activities);
  const overdueClose = computeOverdueFollowUps(scoped.deals);
  if (overdueActivities.length === 0 && overdueClose.count === 0) {
    return { text: "Nothing is overdue in your current scope — no overdue Activities, no Deals past their expected closing date.", insight: null };
  }
  const text = `${overdueActivities.length} Activit${overdueActivities.length === 1 ? "y is" : "ies are"} overdue, and ${overdueClose.count} open Deal${overdueClose.count === 1 ? "" : "s"} ${overdueClose.count === 1 ? "has" : "have"} passed ${overdueClose.count === 1 ? "its" : "their"} expected closing date.`;
  return {
    text,
    insight: createInsight({
      id: `copilot-overdue-${Date.now()}`, type: "overdue_summary", module: "activities",
      title: "Overdue items", summary: text,
      explanation: "Counts Activities whose due date has passed without completion, and open Deals whose expected closing date has passed.",
      priority: overdueActivities.length + overdueClose.count >= 5 ? "High" : "Medium",
      confidence: createConfidence("High Confidence", "Both checks compare an explicit date field against today."),
      affectedRecordIds: overdueClose.deals.map((d) => d._id),
      evidence: overdueClose.deals.slice(0, 5).map((d) => evidence({
        recordType: "Deal", record: d, label: d.name, field: "Expected closing date", value: new Date(d.expectedClosingDate).toLocaleDateString(),
        explanation: "Date has passed while the Deal is still Open.", role,
      })),
      suggestedActions: [], dataRange: "As of today", createdAt: now(),
    }),
  };
}

function handleOpportunities(scoped, role) {
  const qualifiedNoDeal = computeQualifiedLeadsWithoutDeals(scoped.leads);
  if (qualifiedNoDeal.count === 0) {
    return { text: "No Qualified Leads are currently waiting to be converted into a Deal in your scope.", insight: null };
  }
  const text = `${qualifiedNoDeal.count} Qualified Lead${qualifiedNoDeal.count === 1 ? " has" : "s have"} not yet been converted into a Deal — that's the most direct opportunity in scope right now.`;
  return {
    text,
    insight: createInsight({
      id: `copilot-opportunities-${Date.now()}`, type: "qualified_leads_without_deals", module: "sales",
      title: "Qualified Leads without a Deal", summary: text,
      explanation: "Reads Lead status directly and checks for a linked Deal via convertedTo.dealId.",
      priority: "Medium",
      confidence: createConfidence("High Confidence", "Lead status and conversion linkage are explicit fields."),
      affectedRecordIds: qualifiedNoDeal.leads.map((l) => l._id),
      evidence: qualifiedNoDeal.leads.slice(0, 5).map((l) => evidence({
        recordType: "Lead", record: l, label: l.name, field: "Status", value: "Qualified", explanation: "No linked Deal found for this Lead.", role,
      })),
      suggestedActions: qualifiedNoDeal.leads.slice(0, 1).map((l) => createSuggestedAction({
        id: `${l._id}-copilot-create-deal`, type: "create_deal_from_lead", label: "Create a Deal from this Lead",
        reason: "Qualified Lead ready to be worked as a Deal.", affectedRecordId: l._id, affectedRecordType: "Lead",
        requiredApprover: "Lead owner",
      })),
      dataRange: "Current Leads", createdAt: now(),
    }),
  };
}

function handleContracts(scoped, role) {
  const expiringSoon = computeContractsExpiringSoon(scoped.contracts);
  const renewalDue = computeContractsRenewalDue(scoped.contracts);
  if (expiringSoon.count === 0 && renewalDue.count === 0) {
    return { text: "No Contracts in your current scope are expiring soon or within their renewal notice window.", insight: null };
  }
  const text = `${expiringSoon.count} Contract${expiringSoon.count === 1 ? "" : "s"} expire${expiringSoon.count === 1 ? "s" : ""} within 30 days, and ${renewalDue.count} ${renewalDue.count === 1 ? "is" : "are"} within its renewal notice window.`;
  return {
    text,
    insight: createInsight({
      id: `copilot-contracts-${Date.now()}`, type: "contracts_expiring_summary", module: "contracts",
      title: "Contracts needing renewal attention", summary: text,
      explanation: "Compares each Signed Contract's end date and renewal notice period against today.",
      priority: "High",
      confidence: createConfidence("High Confidence", "End date and renewal notice period are explicit Contract fields."),
      affectedRecordIds: [...new Set([...expiringSoon.contracts, ...renewalDue.contracts].map((c) => c._id))],
      evidence: expiringSoon.contracts.slice(0, 5).map((c) => evidence({
        recordType: "Contract", record: c, label: c.contractType, field: "End date", value: new Date(c.endDate).toLocaleDateString(),
        explanation: "Within 30 days of expiration.", role,
      })),
      suggestedActions: expiringSoon.contracts.slice(0, 1).map((c) => createSuggestedAction({
        id: `${c._id}-copilot-renewal`, type: "start_renewal_review", label: "Start renewal review",
        reason: "Contract is approaching its end date.", affectedRecordId: c._id, affectedRecordType: "Contract",
        requiredApprover: "Contract owner",
      })),
      dataRange: "Next 30 days", createdAt: now(),
    }),
  };
}

function handleLeadConversion(scoped) {
  const totals = computeLeadTotals(scoped.leads);
  const conversion = computeLeadConversionRate(scoped.leads);
  if (totals.total === 0) {
    return { text: "There are no Leads in your current scope.", insight: null };
  }
  const text = conversion.rate !== null
    ? `${totals.total} active Lead${totals.total === 1 ? "" : "s"} in scope, with a ${conversion.rate}% conversion rate (${conversion.convertedCount} of ${conversion.eligibleCount} eligible Leads converted).`
    : `${totals.total} active Lead${totals.total === 1 ? "" : "s"} in scope. Not enough eligible Leads yet to calculate a meaningful conversion rate.`;
  return {
    text,
    insight: createInsight({
      id: `copilot-lead-conversion-${Date.now()}`, type: "lead_pipeline_overview", module: "sales",
      title: "Lead conversion", summary: text,
      explanation: "Counts non-archived Leads and divides Converted Leads by all Leads eligible to convert (excluding Unqualified, Duplicate and Spam).",
      priority: "Informational",
      confidence: createConfidence("High Confidence", "Lead counts and status are explicit fields — this is a direct tally, not an estimate."),
      affectedRecordIds: [], evidence: [], suggestedActions: [], dataRange: "Current Leads", createdAt: now(),
    }),
  };
}

function handleHelp() {
  return {
    text: `I can answer questions calculated from your current CRM and Sales data — I'm not a general-purpose assistant. Try asking things like:\n${SUGGESTED_PROMPTS.map((p) => `• ${p}`).join("\n")}`,
    insight: null,
  };
}

function handleGreeting() {
  return {
    text: "Hi — I can answer questions about your current CRM and Sales data using the same calculations as the AI Intelligence Overview. Ask me about at-risk Deals, pipeline value, data quality, overdue items, opportunities, contracts or lead conversion.",
    insight: null,
  };
}

function handleFallback() {
  return {
    text: `I don't have a calculation for that yet, so I won't guess. I can currently answer questions about:\n${SUGGESTED_PROMPTS.map((p) => `• ${p}`).join("\n")}`,
    insight: null,
  };
}

// ---------------------------------------------------------------------------
// Intent matching — plain keyword scoring, not NLP. Listed most-specific
// first since the first intent to reach the top score wins ties.
// ---------------------------------------------------------------------------
const INTENTS = [
  { id: "at_risk_deals", keywords: ["at risk", "at-risk", "risk", "attention", "trouble", "stale", "inactive", "no activity", "no recent activity"], handler: handleAtRiskDeals },
  { id: "pipeline_value", keywords: ["pipeline", "how much pipeline", "pipeline value", "weighted", "forecast", "worth"], handler: handlePipelineValue },
  { id: "data_quality", keywords: ["data quality", "duplicate", "missing information", "missing data", "incomplete", "data issue"], handler: handleDataQuality },
  { id: "overdue", keywords: ["overdue", "follow up", "follow-up", "late", "past due"], handler: handleOverdue },
  { id: "opportunities", keywords: ["opportunit", "qualified lead", "leads without", "convert", "missing"], handler: handleOpportunities },
  { id: "contracts", keywords: ["contract", "renewal", "renewals", "expiring", "expire"], handler: handleContracts },
  { id: "lead_conversion", keywords: ["conversion", "how many leads", "lead total", "lead count", "leads"], handler: handleLeadConversion },
  { id: "help", keywords: ["help", "what can you do", "commands", "options", "what can i ask"], handler: handleHelp },
  { id: "greeting", keywords: ["hi", "hello", "hey", "greetings"], handler: handleGreeting },
];

export function matchIntent(message) {
  const text = message.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const intent of INTENTS) {
    const score = intent.keywords.reduce((sum, kw) => sum + (text.includes(kw) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = intent;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Entry point — answers one chat message against the current scoped data.
// Scoping happens first, exactly like a full analysis, so an unauthorized
// record can never surface in a Copilot answer either.
// ---------------------------------------------------------------------------
export function answerCopilotQuestion(message, request, sharedData) {
  const scoped = scopeSharedData(sharedData, request);
  const intent = matchIntent(message);
  const { text, insight } = intent ? intent.handler(scoped, request.role) : handleFallback();
  return { id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: "assistant", text, insight, matchedIntent: intent?.id || null, createdAt: now() };
}
