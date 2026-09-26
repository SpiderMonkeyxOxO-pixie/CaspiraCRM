// The frontend AI preview engine — the ONLY implementation of the
// provider-neutral AIAnalysisResponse contract that exists today.
//
// This is a deterministic calculator, not a model call: it reads shared
// fixture arrays already in Redux, narrows them to what the requesting
// role/scope may see, runs the pure functions in aiSelectors.js, and
// assembles the results into AIInsight objects with real evidence. It never
// calls fetch/axios and never invents a number — every figure quoted in an
// insight's summary is read back out of the same selector result the
// evidence section shows.
//
// Swap-out contract: a future backend AI gateway only needs to return the
// same AIAnalysisResponse shape (see aiTypes.js) for the UI to keep working
// unchanged — this file is the part that gets replaced, not the page.
import {
  createInsight, createEvidenceReference, createSuggestedAction, createConfidence,
  createDataFreshness, createAnalysisResponse, createProviderStatus,
} from "./aiTypes";
import { canOpenModuleRoute, STANDARD_LIMITATIONS } from "./aiConfig";
import {
  scopeRecords, computeLeadTotals, computeLeadConversionRate, computeQualifiedLeadsWithoutDeals,
  computeDealInactivity, computeOverdueFollowUps, computeAtRiskAndStaleDeals, computeHighValueAtRiskDeals,
  computePipelineConcentration, computeDealsLackingProductsOrOwner, computeCompaniesWithoutOpenDeals,
  computeRepeatWinCompanies, computeDormantCompaniesWithPriorRevenue, computeRenewalEligibleCustomers,
  computeOverdueActivities, computeUserOverdueLoad, computeCompaniesWithoutRecentActivity,
  computeUsersWithoutScheduledNextActions, computeExpiredQuotesLinkedToOpenDeals,
  computeContractsExpiringSoon, computeContractsRenewalDue, computeContractsWithoutOwner,
  computeContractValueMismatches, computeLeadsWithoutContactInfo, computeContactsWithoutCompany,
  computeCompaniesWithoutPrimaryContact, computeDuplicateRisk, computeDealsMissingClosingDate,
  computeOpenPipeline, computeWeightedPipeline, formatByCurrency,
} from "./aiSelectors";
import { CRM_TEAM, CURRENT_MOCK_OWNER_ID, findTeamMember } from "../../Helpers/mockUsersData";

const MASKED_NOTICE = "Additional restricted information is available to authorized roles.";
const verb = (count, singular, plural) => (count === 1 ? singular : plural);

// Checker (Auditor/Checker) has no live CRM/Sales route access today — the
// AI page still lets them review evidence and history, but exact monetary
// figures for those modules stay masked, matching what their role can
// otherwise see, rather than the AI page leaking values a Checker could
// never see anywhere else in the app.
function moneyFor(role, formatted) {
  return role === "Checker" ? MASKED_NOTICE : formatted;
}

// Builds an evidence reference and resolves its route from the record's
// own module — crm for Deal/Lead/Company/Contact, sales for Quote/Order/
// Contract — so a role without that module's access gets plain text.
function evidence({ recordType, record, label, field, value, date, explanation, role }) {
  const moduleByType = {
    Deal: "crm", Lead: "crm", Company: "crm", Contact: "crm", Quote: "sales", Order: "sales", Contract: "sales",
  };
  const pathByType = {
    Deal: `/crm/deals/${record._id}`, Lead: `/crm/leads/${record._id}`, Company: `/crm/companies/${record._id}`,
    Contact: `/crm/contacts/${record._id}`, Quote: `/sales/quotes/${record._id}`, Order: `/sales/orders/${record._id}`,
    Contract: `/sales/contracts/${record._id}`,
  };
  const authorized = canOpenModuleRoute(role, moduleByType[recordType]);
  return createEvidenceReference({
    recordType, recordId: record._id, recordLabel: label,
    supportingField: field, supportingValue: value, date: date || null, explanation,
    route: authorized ? pathByType[recordType] : null,
  });
}

function ownerName(ownerId) {
  return findTeamMember(ownerId)?.name || null;
}

function lastActivityFns(activities, companies) {
  const byDeal = new Map();
  const byCompany = new Map();
  for (const a of activities) {
    if (!a.completedAt) continue;
    if (a.relatedRecordType === "Deal" && a.relatedRecordId) {
      const prev = byDeal.get(a.relatedRecordId);
      if (!prev || new Date(a.completedAt) > new Date(prev)) byDeal.set(a.relatedRecordId, a.completedAt);
    }
    if (a.relatedRecordType === "Company" && a.relatedRecordId) {
      const prev = byCompany.get(a.relatedRecordId);
      if (!prev || new Date(a.completedAt) > new Date(prev)) byCompany.set(a.relatedRecordId, a.completedAt);
    }
  }
  for (const c of companies) {
    const log = c.activity || [];
    if (!log.length) continue;
    const latest = log.reduce((acc, e) => (!acc || new Date(e.at) > new Date(acc) ? e.at : acc), null);
    if (latest) {
      const prev = byCompany.get(c._id);
      if (!prev || new Date(latest) > new Date(prev)) byCompany.set(c._id, latest);
    }
  }
  return { dealLastActivityAt: (id) => byDeal.get(id) || null, companyLastActivityAt: (id) => byCompany.get(id) || null };
}

// ---------------------------------------------------------------------------
// Scope resolution — every array below is narrowed BEFORE any insight is
// computed, so an unauthorized record can never influence a count, a total,
// or an evidence reference.
// ---------------------------------------------------------------------------
function scopeSharedData(data, request) {
  const { scope, team } = request;
  const opts = { scope, currentOwnerId: CURRENT_MOCK_OWNER_ID, team };
  const deals = scopeRecords(data.deals, opts);
  const dealIds = new Set(deals.map((d) => d._id));
  const companyIds = new Set(deals.map((d) => d.companyId).filter(Boolean));
  // Leads/activities/companies scope the same way deals do (by owner/team);
  // Quotes/Orders/Contracts follow whichever deals/companies survived
  // scoping, since they don't carry their own team field.
  const leads = scopeRecords(data.leads, { ...opts, teamField: "department" });
  const activities = scopeRecords(data.activities, opts);
  let companies = scopeRecords(data.companies, opts);
  if (scope === "mine" || scope === "team" || scope === "department") {
    companies = companies.filter((c) => companyIds.has(c._id) || c.ownerId === CURRENT_MOCK_OWNER_ID);
  }
  const scopedCompanyIds = new Set(companies.map((c) => c._id));
  const contacts = data.contacts.filter((c) => !opts.scope || opts.scope === "all" || scopedCompanyIds.has(c.companyId));
  const quotes = data.quotes.filter((q) => scope === "all" || dealIds.has(q.dealId) || scopedCompanyIds.has(q.companyId));
  const orders = data.orders.filter((o) => scope === "all" || scopedCompanyIds.has(o.companyId));
  const contracts = data.contracts.filter((c) => scope === "all" || scopedCompanyIds.has(c.companyId));
  return { deals, leads, activities, companies, contacts, quotes, orders, contracts };
}

function computeDataFreshness(data) {
  let latest = null;
  for (const arr of Object.values(data)) {
    for (const r of arr) {
      const ts = r.updatedAt || r.createdAt;
      if (ts && (!latest || new Date(ts) > new Date(latest))) latest = ts;
    }
  }
  const recordCount = Object.values(data).reduce((sum, arr) => sum + arr.length, 0);
  return createDataFreshness({ latestRecordUpdatedAt: latest, generatedAt: new Date().toISOString(), recordCount });
}

// ---------------------------------------------------------------------------
// Insight builders — one function per scenario. Each reads a single
// aiSelectors result and turns it into an AIInsight with real evidence, a
// written (never fabricated-decimal) confidence explanation, and — where
// applicable — a suggested action requiring human confirmation.
// ---------------------------------------------------------------------------
function buildSalesRiskInsights(scoped, role, now) {
  const insights = [];
  const { dealLastActivityAt } = lastActivityFns(scoped.activities, scoped.companies);

  const inactivity = computeDealInactivity(scoped.deals, dealLastActivityAt, 14);
  if (inactivity.count > 0) {
    insights.push(createInsight({
      id: "sales-deal-inactivity", type: "deal_inactivity", module: "sales",
      title: "Deals with no recent activity",
      summary: `${inactivity.count} Deal${inactivity.count === 1 ? "" : "s"} worth ${moneyFor(role, formatByCurrency(inactivity.valueByCurrency))} ${verb(inactivity.count, "has", "have")} no recorded activity in the last ${inactivity.days} days.`,
      explanation: "Calculated from each open Deal's most recent completed Activity (or its last update if none exists) against today's date.",
      priority: inactivity.count >= 5 ? "Critical" : "High",
      confidence: createConfidence("High Confidence", "Based on the absence of any completed Activity record — a deterministic count, not an estimate."),
      affectedRecordIds: inactivity.dealIds,
      evidence: inactivity.deals.slice(0, 8).map((d) => evidence({
        recordType: "Deal", record: d, label: d.name, field: "Last activity", value: dealLastActivityAt(d._id) || "None recorded",
        explanation: "No completed Activity found within the inactivity window.", role,
      })),
      suggestedActions: [createSuggestedAction({
        id: `${inactivity.dealIds[0]}-follow-up`, type: "create_follow_up", label: "Create a follow-up",
        reason: "Re-engage before the Deal goes fully cold.", affectedRecordId: inactivity.dealIds[0], affectedRecordType: "Deal",
        proposedValues: { type: "Follow-up" }, requiredApprover: "Deal owner",
      })],
      dataRange: `Last ${inactivity.days} days`, createdAt: now,
    }));
  }

  const overdueClose = computeOverdueFollowUps(scoped.deals);
  if (overdueClose.count > 0) {
    insights.push(createInsight({
      id: "sales-overdue-close", type: "overdue_expected_close", module: "sales",
      title: "Deals past their expected closing date",
      summary: `${overdueClose.count} open Deal${overdueClose.count === 1 ? "" : "s"} worth ${moneyFor(role, formatByCurrency(overdueClose.valueByCurrency))} passed ${verb(overdueClose.count, "its", "their")} expected closing date without being marked Won or Lost.`,
      explanation: "Compares each open Deal's expectedClosingDate against today.",
      priority: "High",
      confidence: createConfidence("High Confidence", "Expected closing date is an explicit field — this is a direct comparison, not an inference."),
      affectedRecordIds: overdueClose.deals.map((d) => d._id),
      evidence: overdueClose.deals.slice(0, 8).map((d) => evidence({
        recordType: "Deal", record: d, label: d.name, field: "Expected closing date", value: new Date(d.expectedClosingDate).toLocaleDateString(),
        explanation: "Date has passed while the Deal is still Open.", role,
      })),
      suggestedActions: overdueClose.deals.slice(0, 1).map((d) => createSuggestedAction({
        id: `${d._id}-update-close`, type: "update_expected_closing_date", label: "Update expected closing date",
        reason: "Keep the pipeline forecast accurate.", affectedRecordId: d._id, affectedRecordType: "Deal",
        currentValues: { expectedClosingDate: d.expectedClosingDate }, requiredApprover: "Deal owner",
      })),
      dataRange: "As of today", createdAt: now,
    }));
  }

  const atRisk = computeAtRiskAndStaleDeals(scoped.deals, dealLastActivityAt);
  const noNextAction = atRisk.filter((x) => x.reasons.includes("No next action set"));
  if (noNextAction.length > 0) {
    insights.push(createInsight({
      id: "sales-no-next-action", type: "no_next_action", module: "sales",
      title: "Deals with no next action set",
      summary: `${noNextAction.length} open Deal${noNextAction.length === 1 ? "" : "s"} ${verb(noNextAction.length, "has", "have")} no next action recorded.`,
      explanation: "Reads the Deal's nextAction field directly.",
      priority: "Medium",
      confidence: createConfidence("High Confidence", "nextAction is an explicit field on the Deal record."),
      affectedRecordIds: noNextAction.map((x) => x.deal._id),
      evidence: noNextAction.slice(0, 8).map((x) => evidence({
        recordType: "Deal", record: x.deal, label: x.deal.name, field: "Next action", value: "Not set",
        explanation: "No next action has been recorded on this Deal.", role,
      })),
      suggestedActions: noNextAction.slice(0, 1).map((x) => createSuggestedAction({
        id: `${x.deal._id}-next-action`, type: "add_next_action", label: "Add a next action",
        reason: "Every active Deal should have a defined next step.", affectedRecordId: x.deal._id, affectedRecordType: "Deal",
        requiredApprover: "Deal owner",
      })),
      dataRange: "Current pipeline", createdAt: now,
    }));
  }

  const expiredProposal = atRisk.filter((x) => x.reasons.some((r) => r.includes("proposal/quote has expired")));
  if (expiredProposal.length > 0) {
    insights.push(createInsight({
      id: "sales-expired-proposal", type: "expired_proposal", module: "sales",
      title: "Deals with an expired proposal",
      summary: `${expiredProposal.length} open Deal${expiredProposal.length === 1 ? "" : "s"} ${verb(expiredProposal.length, "has", "have")} a Quote that expired before being accepted.`,
      explanation: "Cross-references each Deal's linked Quotes against their validUntilDate.",
      priority: "High",
      confidence: createConfidence("High Confidence", "Quote expiration dates are explicit fields."),
      affectedRecordIds: expiredProposal.map((x) => x.deal._id),
      evidence: expiredProposal.slice(0, 6).map((x) => evidence({
        recordType: "Deal", record: x.deal, label: x.deal.name, field: "Quote status", value: "Expired",
        explanation: "A linked Quote passed its validity date while still Open.", role,
      })),
      suggestedActions: expiredProposal.slice(0, 1).map((x) => createSuggestedAction({
        id: `${x.deal._id}-review-quote`, type: "open_affected_records", label: "Open the Deal to review the Quote",
        reason: "Decide whether to re-issue or replace the expired proposal.", affectedRecordId: x.deal._id, affectedRecordType: "Deal",
        requiredApprover: "Deal owner",
      })),
      dataRange: "Current pipeline", createdAt: now,
    }));
  }

  const rescheduled = atRisk.filter((x) => x.reasons.some((r) => r.includes("Re-entered this stage")));
  if (rescheduled.length > 0) {
    insights.push(createInsight({
      id: "sales-repeated-reschedule", type: "repeated_reschedule", module: "sales",
      title: "Deals repeatedly re-entering the same stage",
      summary: `${rescheduled.length} Deal${rescheduled.length === 1 ? "" : "s"} ${verb(rescheduled.length, "has", "have")} moved back into a stage ${verb(rescheduled.length, "it was", "they were")} already in — a pattern often tied to delays.`,
      explanation: "Counts how many times each Deal's stage-history shows a repeat entry into its current stage.",
      priority: "Medium",
      confidence: createConfidence("Medium Confidence", "Stage re-entry is a proxy for delay, not a direct measurement of the cause."),
      affectedRecordIds: rescheduled.map((x) => x.deal._id),
      evidence: rescheduled.slice(0, 6).map((x) => evidence({
        recordType: "Deal", record: x.deal, label: x.deal.name, field: "Stage history", value: `Re-entered ${x.deal.stage}`,
        explanation: "Stage history shows more than one entry into the current stage.", role,
      })),
      suggestedActions: [], dataRange: "Full stage history", createdAt: now,
    }));
  }

  const highValue = computeHighValueAtRiskDeals(scoped.deals, dealLastActivityAt);
  if (highValue.count > 0) {
    insights.push(createInsight({
      id: "sales-high-value-at-risk", type: "high_value_at_risk", module: "sales",
      title: "High-value Deals at risk",
      summary: `${highValue.count} at-risk Deal${highValue.count === 1 ? "" : "s"} worth ${moneyFor(role, formatByCurrency(highValue.valueByCurrency))} ${verb(highValue.count, "is", "are")} above the average open Deal size.`,
      explanation: "Intersects the at-risk Deal list with Deals valued at or above the current average open Deal size.",
      priority: "Critical",
      confidence: createConfidence("Medium Confidence", "\"High-value\" is defined relative to the current average open Deal size, which shifts as the pipeline changes."),
      affectedRecordIds: highValue.entries.map((x) => x.deal._id),
      evidence: highValue.entries.slice(0, 6).map((x) => evidence({
        recordType: "Deal", record: x.deal, label: x.deal.name, field: "Risk reasons", value: x.reasons.join("; "),
        explanation: "Deal value is above average and at least one risk reason applies.", role,
      })),
      suggestedActions: [], dataRange: "Current pipeline", createdAt: now,
    }));
  }

  const concentration = computePipelineConcentration(scoped.deals);
  if (concentration.isConcentrated) {
    const company = scoped.companies.find((c) => c._id === concentration.companyId);
    insights.push(createInsight({
      id: "sales-pipeline-concentration", type: "pipeline_concentration", module: "sales",
      title: "Pipeline concentrated in one Company",
      summary: `${concentration.share}% of open pipeline value is with a single Company${company ? ` (${company.name})` : ""}.`,
      explanation: "Groups open Deal value by Company and compares the largest share against total open pipeline value.",
      priority: concentration.share >= 60 ? "High" : "Medium",
      confidence: createConfidence("High Confidence", "Direct sum of open Deal values grouped by Company."),
      affectedRecordIds: company ? [company._id] : [],
      evidence: company ? [evidence({
        recordType: "Company", record: company, label: company.name, field: "Share of open pipeline", value: `${concentration.share}%`,
        explanation: "Largest single-Company share of total open pipeline value.", role,
      })] : [],
      suggestedActions: [], dataRange: "Current pipeline", createdAt: now,
    }));
  }

  const lacking = computeDealsLackingProductsOrOwner(scoped.deals);
  if (lacking.lackingOwner.length > 0) {
    insights.push(createInsight({
      id: "sales-deals-without-owner", type: "deal_without_owner", module: "sales",
      title: "Deals with no assigned owner",
      summary: `${lacking.lackingOwner.length} open Deal${lacking.lackingOwner.length === 1 ? "" : "s"} ${verb(lacking.lackingOwner.length, "has", "have")} no assigned owner.`,
      explanation: "Reads the Deal's ownerId field directly.",
      priority: "High",
      confidence: createConfidence("High Confidence", "ownerId is an explicit field."),
      affectedRecordIds: lacking.lackingOwner.map((d) => d._id),
      evidence: lacking.lackingOwner.slice(0, 6).map((d) => evidence({
        recordType: "Deal", record: d, label: d.name, field: "Owner", value: "Unassigned", explanation: "No owner is assigned to this Deal.", role,
      })),
      suggestedActions: lacking.lackingOwner.slice(0, 1).map((d) => createSuggestedAction({
        id: `${d._id}-assign-owner`, type: "assign_owner", label: "Assign an owner",
        reason: "An unowned Deal has no accountable follow-up.", affectedRecordId: d._id, affectedRecordType: "Deal",
        requiredApprover: "Sales Manager",
      })),
      dataRange: "Current pipeline", createdAt: now,
    }));
  }

  return insights;
}

function buildSalesOpportunityInsights(scoped, role, now) {
  const insights = [];
  const { companyLastActivityAt } = lastActivityFns(scoped.activities, scoped.companies);

  const leadTotals = computeLeadTotals(scoped.leads);
  const conversion = computeLeadConversionRate(scoped.leads);
  if (leadTotals.total > 0) {
    insights.push(createInsight({
      id: "opp-lead-pipeline-overview", type: "lead_pipeline_overview", module: "sales",
      title: "Lead pipeline overview",
      summary: conversion.rate !== null
        ? `${leadTotals.total} active Lead${leadTotals.total === 1 ? "" : "s"} in scope, with a ${conversion.rate}% conversion rate (${conversion.convertedCount} of ${conversion.eligibleCount} eligible Leads converted).`
        : `${leadTotals.total} active Lead${leadTotals.total === 1 ? "" : "s"} in scope. Not enough eligible Leads to calculate a conversion rate.`,
      explanation: "Counts non-archived Leads and divides Converted Leads by all Leads eligible to convert (excluding Unqualified, Duplicate and Spam).",
      priority: "Informational",
      confidence: createConfidence("High Confidence", "Lead counts and status are explicit fields — this is a direct tally, not an estimate."),
      affectedRecordIds: [], evidence: [], suggestedActions: [], dataRange: "Current Leads", createdAt: now,
    }));
  }

  const qualifiedNoDeal = computeQualifiedLeadsWithoutDeals(scoped.leads);
  if (qualifiedNoDeal.count > 0) {
    insights.push(createInsight({
      id: "opp-qualified-leads-no-deal", type: "qualified_leads_without_deals", module: "sales",
      title: "Qualified Leads without a Deal",
      summary: `${qualifiedNoDeal.count} Qualified Lead${qualifiedNoDeal.count === 1 ? "" : "s"} ${verb(qualifiedNoDeal.count, "has", "have")} not yet been converted into a Deal.`,
      explanation: "Reads Lead status directly and checks for a linked Deal via convertedTo.dealId.",
      priority: "Medium",
      confidence: createConfidence("High Confidence", "Lead status and conversion linkage are explicit fields."),
      affectedRecordIds: qualifiedNoDeal.leads.map((l) => l._id),
      evidence: qualifiedNoDeal.leads.slice(0, 8).map((l) => evidence({
        recordType: "Lead", record: l, label: l.name, field: "Status", value: "Qualified", explanation: "No linked Deal found for this Lead.", role,
      })),
      suggestedActions: qualifiedNoDeal.leads.slice(0, 1).map((l) => createSuggestedAction({
        id: `${l._id}-create-deal`, type: "create_deal_from_lead", label: "Create a Deal from this Lead",
        reason: "Qualified Leads ready to be worked as a Deal.", affectedRecordId: l._id, affectedRecordType: "Lead",
        requiredApprover: "Lead owner",
      })),
      dataRange: "Current Leads", createdAt: now,
    }));
  }

  const companiesNoOpenDeal = computeCompaniesWithoutOpenDeals(scoped.companies, scoped.deals);
  if (companiesNoOpenDeal.count > 0) {
    insights.push(createInsight({
      id: "opp-companies-no-open-deal", type: "active_companies_without_deals", module: "sales",
      title: "Active Companies without an open Deal",
      summary: `${companiesNoOpenDeal.count} active Company account${companiesNoOpenDeal.count === 1 ? "" : "s"} currently ${verb(companiesNoOpenDeal.count, "has", "have")} no open Deal.`,
      explanation: "Compares active Companies against the set of Companies with at least one Open Deal.",
      priority: "Low",
      confidence: createConfidence("High Confidence", "Customer status and open-Deal linkage are both explicit."),
      affectedRecordIds: companiesNoOpenDeal.companies.map((c) => c._id),
      evidence: companiesNoOpenDeal.companies.slice(0, 8).map((c) => evidence({
        recordType: "Company", record: c, label: c.name, field: "Open Deals", value: "None", explanation: "No Open Deal is linked to this Company.", role,
      })),
      suggestedActions: [], dataRange: "Current accounts", createdAt: now,
    }));
  }

  const renewalEligible = computeRenewalEligibleCustomers(scoped.companies, scoped.contracts);
  if (renewalEligible.count > 0) {
    insights.push(createInsight({
      id: "opp-renewal-eligible", type: "renewal_eligible", module: "contracts",
      title: "Customers eligible for renewal",
      summary: `${renewalEligible.count} Compan${renewalEligible.count === 1 ? "y is" : "ies are"} within the renewal notice window on a Signed Contract.`,
      explanation: "Uses each Contract's renewalNoticeDays against its remaining days until endDate.",
      priority: "High",
      confidence: createConfidence("High Confidence", "Renewal notice period and end date are explicit Contract fields."),
      affectedRecordIds: renewalEligible.companies.flatMap((x) => x.contracts.map((c) => c._id)),
      evidence: renewalEligible.companies.slice(0, 6).flatMap((x) => x.contracts.map((c) => evidence({
        recordType: "Contract", record: c, label: `${x.company.name} — ${c.contractType}`, field: "Renewal window", value: "Open",
        explanation: "Contract is within its renewal notice period.", role,
      }))),
      suggestedActions: renewalEligible.companies.slice(0, 1).flatMap((x) => x.contracts.slice(0, 1).map((c) => createSuggestedAction({
        id: `${c._id}-start-renewal`, type: "start_renewal_review", label: "Start renewal review",
        reason: "Renewal notice window is open.", affectedRecordId: c._id, affectedRecordType: "Contract",
        requiredApprover: "Contract owner",
      }))),
      dataRange: "Active Contracts", createdAt: now,
    }));
  }

  const repeatWins = computeRepeatWinCompanies(scoped.companies, scoped.deals, 2);
  if (repeatWins.count > 0) {
    insights.push(createInsight({
      id: "opp-repeat-wins", type: "repeat_win_companies", module: "sales",
      title: "Companies with multiple successful Deals",
      summary: `${repeatWins.count} Compan${repeatWins.count === 1 ? "y has" : "ies have"} won 2 or more Deals — a strong cross-sell/upsell base.`,
      explanation: "Counts Won Deals grouped by Company.",
      priority: "Low",
      confidence: createConfidence("High Confidence", "Won-Deal counts are a direct tally, not an estimate."),
      affectedRecordIds: repeatWins.companies.map((x) => x.company._id),
      evidence: repeatWins.companies.slice(0, 6).map((x) => evidence({
        recordType: "Company", record: x.company, label: x.company.name, field: "Won Deals", value: String(x.wins),
        explanation: "Number of Deals with status Won linked to this Company.", role,
      })),
      suggestedActions: [], dataRange: "All time", createdAt: now,
    }));
  }

  const dormant = computeDormantCompaniesWithPriorRevenue(scoped.companies, scoped.deals, companyLastActivityAt, 90);
  if (dormant.count > 0) {
    insights.push(createInsight({
      id: "opp-dormant-companies", type: "dormant_company_prior_revenue", module: "sales",
      title: "Dormant Companies with prior revenue",
      summary: `${dormant.count} Compan${dormant.count === 1 ? "y has" : "ies have"} at least one Won Deal but no recorded contact in 90+ days.`,
      explanation: "Combines Won-Deal history with the most recent recorded Activity or activity-log entry per Company.",
      priority: "Medium",
      confidence: createConfidence("Medium Confidence", "Absence of a logged Activity is a proxy for dormancy, not direct confirmation that no contact occurred."),
      affectedRecordIds: dormant.companies.map((c) => c._id),
      evidence: dormant.companies.slice(0, 6).map((c) => evidence({
        recordType: "Company", record: c, label: c.name, field: "Last contact", value: "90+ days ago or unrecorded",
        explanation: "This Company previously won at least one Deal.", role,
      })),
      suggestedActions: dormant.companies.slice(0, 1).map((c) => createSuggestedAction({
        id: `${c._id}-re-engage`, type: "create_follow_up", label: "Create a re-engagement follow-up",
        reason: "Past customer with no recent contact.", affectedRecordId: c._id, affectedRecordType: "Company",
        requiredApprover: "Account owner",
      })),
      dataRange: "Last 90 days", createdAt: now,
    }));
  }

  return insights;
}

function buildActivityInsights(scoped, role, now) {
  const insights = [];
  const { companyLastActivityAt } = lastActivityFns(scoped.activities, scoped.companies);

  const overdue = computeOverdueActivities(scoped.activities);
  if (overdue.length > 0) {
    insights.push(createInsight({
      id: "activity-overdue-followups", type: "overdue_followups", module: "activities",
      title: "Overdue follow-ups",
      summary: `${overdue.length} Activit${overdue.length === 1 ? "y is" : "ies are"} overdue.`,
      explanation: "An Activity is Overdue when its due date has passed without being completed or cancelled.",
      priority: overdue.length >= 5 ? "High" : "Medium",
      confidence: createConfidence("High Confidence", "Overdue status is computed directly from the due date and current status."),
      affectedRecordIds: overdue.map((a) => a._id),
      evidence: overdue.slice(0, 8).map((a) => evidence({
        recordType: "Deal", record: { _id: a._id }, label: a.title || a.type, field: "Due date",
        value: a.dueDate ? new Date(a.dueDate).toLocaleDateString() : "—", explanation: "Overdue and not yet completed.", role,
      })).map((e) => ({ ...e, recordType: "Activity", route: null })),
      suggestedActions: [], dataRange: "As of today", createdAt: now,
    }));
  }

  const overloaded = computeUserOverdueLoad(scoped.activities, CRM_TEAM, 3);
  if (overloaded.flagged.length > 0) {
    insights.push(createInsight({
      id: "activity-overloaded-users", type: "user_overdue_load", module: "activities",
      title: "Team members with excessive overdue Activities",
      summary: `${overloaded.flagged.length} team member${overloaded.flagged.length === 1 ? "" : "s"} ${verb(overloaded.flagged.length, "has", "have")} 3 or more overdue Activities.`,
      explanation: "Groups overdue Activities by owner and flags anyone at or above the threshold.",
      priority: "Medium",
      confidence: createConfidence("High Confidence", "Direct count of overdue Activities per owner."),
      affectedRecordIds: overloaded.flagged.map((x) => x.member.id),
      evidence: overloaded.flagged.map((x) => createEvidenceReference({
        recordType: "Owner", recordId: x.member.id, recordLabel: x.member.name, supportingField: "Overdue Activities",
        supportingValue: String(x.count), explanation: "Count of Activities past due for this team member.", route: null,
      })),
      suggestedActions: [], dataRange: "As of today", createdAt: now,
    }));
  }

  const noContact = computeCompaniesWithoutRecentActivity(scoped.companies, companyLastActivityAt, 30);
  const trulyStale = noContact.companies.filter((x) => x.daysSinceContact !== null);
  if (trulyStale.length > 0) {
    insights.push(createInsight({
      id: "activity-companies-no-contact", type: "company_no_recent_contact", module: "activities",
      title: "Companies without recent communication",
      summary: `${trulyStale.length} Compan${trulyStale.length === 1 ? "y has" : "ies have"} had no recorded contact in the last 30 days.`,
      explanation: "Reads each Company's most recent completed Activity or activity-log entry.",
      priority: "Low",
      confidence: createConfidence("Medium Confidence", "Based on recorded Activities only — contact that happened but wasn't logged would not be reflected."),
      affectedRecordIds: trulyStale.map((x) => x.company._id),
      evidence: trulyStale.slice(0, 6).map((x) => evidence({
        recordType: "Company", record: x.company, label: x.company.name, field: "Last contact",
        value: `${x.daysSinceContact} days ago`, explanation: "Most recent recorded contact for this Company.", role,
      })),
      suggestedActions: [], dataRange: "Last 30 days", createdAt: now,
    }));
  }

  const noScheduled = computeUsersWithoutScheduledNextActions(CRM_TEAM, scoped.activities);
  if (noScheduled.count > 0) {
    insights.push(createInsight({
      id: "activity-no-scheduled-actions", type: "no_scheduled_next_actions", module: "activities",
      title: "Team members with no scheduled next actions",
      summary: `${noScheduled.count} team member${noScheduled.count === 1 ? "" : "s"} ${verb(noScheduled.count, "has", "have")} no upcoming Activity scheduled.`,
      explanation: "Checks whether each team member owns any future, non-cancelled Activity.",
      priority: "Low",
      confidence: createConfidence("Medium Confidence", "Reflects scheduled Activities only, not informal or undocumented plans."),
      affectedRecordIds: noScheduled.members.map((m) => m.id),
      evidence: noScheduled.members.map((m) => createEvidenceReference({
        recordType: "Owner", recordId: m.id, recordLabel: m.name, supportingField: "Upcoming Activities",
        supportingValue: "0", explanation: "No future Activity found for this team member.", route: null,
      })),
      suggestedActions: [], dataRange: "Going forward", createdAt: now,
    }));
  }

  return insights;
}

function buildDataQualityInsights(scoped, role, now) {
  const insights = [];

  const leadsNoContact = computeLeadsWithoutContactInfo(scoped.leads);
  if (leadsNoContact.count > 0) {
    insights.push(createInsight({
      id: "dq-leads-no-contact-info", type: "lead_without_contact_info", module: "data-quality",
      title: "Leads missing contact information",
      summary: `${leadsNoContact.count} Lead${leadsNoContact.count === 1 ? "" : "s"} ${verb(leadsNoContact.count, "has", "have")} neither an email nor a phone number.`,
      explanation: "Checks the Lead's email and phone fields directly.",
      priority: "Medium",
      confidence: createConfidence("High Confidence", "Both fields are explicit and directly checked."),
      affectedRecordIds: leadsNoContact.leads.map((l) => l._id),
      evidence: leadsNoContact.leads.slice(0, 8).map((l) => evidence({
        recordType: "Lead", record: l, label: l.name, field: "Contact info", value: "Missing", explanation: "No email or phone recorded.", role,
      })),
      suggestedActions: leadsNoContact.leads.slice(0, 1).map((l) => createSuggestedAction({
        id: `${l._id}-request-info`, type: "request_missing_information", label: "Request missing information",
        reason: "This Lead cannot be reliably contacted.", affectedRecordId: l._id, affectedRecordType: "Lead",
        requiredApprover: "Lead owner",
      })),
      dataRange: "Current Leads", createdAt: now,
    }));
  }

  const contactsNoCompany = computeContactsWithoutCompany(scoped.contacts);
  if (contactsNoCompany.count > 0) {
    insights.push(createInsight({
      id: "dq-contacts-no-company", type: "contact_without_company", module: "data-quality",
      title: "Contacts without a Company",
      summary: `${contactsNoCompany.count} Contact${contactsNoCompany.count === 1 ? "" : "s"} ${verb(contactsNoCompany.count, "is", "are")} not linked to a Company.`,
      explanation: "Checks the Contact's companyId field directly.",
      priority: "Low",
      confidence: createConfidence("High Confidence", "companyId is an explicit field."),
      affectedRecordIds: contactsNoCompany.contacts.map((c) => c._id),
      evidence: contactsNoCompany.contacts.slice(0, 8).map((c) => evidence({
        recordType: "Contact", record: c, label: c.name, field: "Company", value: "Not linked", explanation: "No companyId set.", role,
      })),
      suggestedActions: [], dataRange: "Current Contacts", createdAt: now,
    }));
  }

  const companiesNoPrimary = computeCompaniesWithoutPrimaryContact(scoped.companies);
  if (companiesNoPrimary.count > 0) {
    insights.push(createInsight({
      id: "dq-companies-no-primary", type: "company_without_primary_contact", module: "data-quality",
      title: "Companies without a primary Contact",
      summary: `${companiesNoPrimary.count} Compan${companiesNoPrimary.count === 1 ? "y has" : "ies have"} no primary Contact set.`,
      explanation: "Checks the Company's primaryContactId field directly.",
      priority: "Low",
      confidence: createConfidence("High Confidence", "primaryContactId is an explicit field."),
      affectedRecordIds: companiesNoPrimary.companies.map((c) => c._id),
      evidence: companiesNoPrimary.companies.slice(0, 8).map((c) => evidence({
        recordType: "Company", record: c, label: c.name, field: "Primary contact", value: "Not set", explanation: "No primaryContactId set.", role,
      })),
      suggestedActions: [], dataRange: "Current Companies", createdAt: now,
    }));
  }

  const missingClose = computeDealsMissingClosingDate(scoped.deals);
  if (missingClose.count > 0) {
    insights.push(createInsight({
      id: "dq-deals-missing-close-date", type: "deal_missing_closing_date", module: "data-quality",
      title: "Open Deals missing an expected closing date",
      summary: `${missingClose.count} open Deal${missingClose.count === 1 ? "" : "s"} ${verb(missingClose.count, "has", "have")} no expected closing date.`,
      explanation: "Checks the Deal's expectedClosingDate field directly.",
      priority: "Medium",
      confidence: createConfidence("High Confidence", "expectedClosingDate is an explicit field."),
      affectedRecordIds: missingClose.deals.map((d) => d._id),
      evidence: missingClose.deals.slice(0, 8).map((d) => evidence({
        recordType: "Deal", record: d, label: d.name, field: "Expected closing date", value: "Not set", explanation: "No expected closing date recorded.", role,
      })),
      suggestedActions: missingClose.deals.slice(0, 1).map((d) => createSuggestedAction({
        id: `${d._id}-set-close-date`, type: "update_expected_closing_date", label: "Set an expected closing date",
        reason: "Needed for accurate pipeline forecasting.", affectedRecordId: d._id, affectedRecordType: "Deal",
        requiredApprover: "Deal owner",
      })),
      dataRange: "Current pipeline", createdAt: now,
    }));
  }

  const expiredQuotes = computeExpiredQuotesLinkedToOpenDeals(scoped.quotes, scoped.deals);
  if (expiredQuotes.count > 0) {
    insights.push(createInsight({
      id: "dq-expired-quotes-open-deal", type: "expired_quote_on_open_deal", module: "data-quality",
      title: "Expired Quotes still linked to an open Deal",
      summary: `${expiredQuotes.count} Quote${expiredQuotes.count === 1 ? " is" : "s are"} expired or expiring while the linked Deal is still Open.`,
      explanation: "Cross-references Quote validUntilDate against the linked Deal's status.",
      priority: "Medium",
      confidence: createConfidence("High Confidence", "Quote validity and Deal status are both explicit fields."),
      affectedRecordIds: expiredQuotes.quotes.map((q) => q._id),
      evidence: expiredQuotes.quotes.slice(0, 6).map((q) => evidence({
        recordType: "Quote", record: q, label: q.title || q.quoteNumber, field: "Validity", value: "Expired or expiring", explanation: "Linked Deal is still Open.", role,
      })),
      suggestedActions: [], dataRange: "Current Quotes", createdAt: now,
    }));
  }

  const duplicates = computeDuplicateRisk(scoped.leads, scoped.contacts, scoped.companies);
  if (duplicates.count > 0) {
    insights.push(createInsight({
      id: "dq-duplicate-risk", type: "duplicate_record_risk", module: "data-quality",
      title: "Possible duplicate records",
      summary: `${duplicates.count} candidate duplicate group${duplicates.count === 1 ? "" : "s"} detected across Leads, Contacts and Companies.`,
      explanation: "Uses the same name/email/phone similarity matching as the completed Duplicate Management route.",
      priority: "Low",
      confidence: createConfidence("Medium Confidence", "Similarity matching flags likely duplicates; each candidate still requires human review to confirm."),
      affectedRecordIds: [],
      evidence: [createEvidenceReference({
        recordType: "Duplicate Group", recordId: "duplicates", recordLabel: `${duplicates.count} candidate group(s)`,
        supportingField: "Match confidence", supportingValue: "High/Medium",
        explanation: "See the Duplicate Management workspace for full comparison.",
        route: canOpenModuleRoute(role, "crm") ? "/crm/duplicates" : null,
      })],
      suggestedActions: [createSuggestedAction({
        id: "review-duplicates", type: "review_duplicate", label: "Review duplicates",
        reason: "Confirm or dismiss candidate duplicate groups.", affectedRecordId: "duplicates", affectedRecordType: "Duplicate Group",
        requiredApprover: "Data owner",
      })],
      dataRange: "Current records", createdAt: now,
    }));
  }

  return insights;
}

function buildContractInsights(scoped, role, now) {
  const insights = [];

  const expiringSoon = computeContractsExpiringSoon(scoped.contracts);
  if (expiringSoon.count > 0) {
    insights.push(createInsight({
      id: "contract-expiring-soon", type: "contract_expiring_soon", module: "contracts",
      title: "Contracts expiring soon",
      summary: `${expiringSoon.count} Signed Contract${expiringSoon.count === 1 ? "" : "s"} ${verb(expiringSoon.count, "expires", "expire")} within the next 30 days.`,
      explanation: "Compares each Signed Contract's endDate against today.",
      priority: "High",
      confidence: createConfidence("High Confidence", "endDate is an explicit Contract field."),
      affectedRecordIds: expiringSoon.contracts.map((c) => c._id),
      evidence: expiringSoon.contracts.slice(0, 6).map((c) => evidence({
        recordType: "Contract", record: c, label: c.contractType, field: "End date", value: new Date(c.endDate).toLocaleDateString(), explanation: "Within 30 days of expiration.", role,
      })),
      suggestedActions: expiringSoon.contracts.slice(0, 1).map((c) => createSuggestedAction({
        id: `${c._id}-renewal-review`, type: "start_renewal_review", label: "Start renewal review",
        reason: "Contract is approaching its end date.", affectedRecordId: c._id, affectedRecordType: "Contract",
        requiredApprover: "Contract owner",
      })),
      dataRange: "Next 30 days", createdAt: now,
    }));
  }

  const renewalDue = computeContractsRenewalDue(scoped.contracts);
  if (renewalDue.count > 0) {
    insights.push(createInsight({
      id: "contract-renewal-notice", type: "renewal_notice_due", module: "contracts",
      title: "Renewal notice deadline approaching",
      summary: `${renewalDue.count} Contract${renewalDue.count === 1 ? " is" : "s are"} within its renewal notice window.`,
      explanation: "Compares remaining days until endDate against each Contract's renewalNoticeDays.",
      priority: "High",
      confidence: createConfidence("High Confidence", "renewalNoticeDays and endDate are explicit fields."),
      affectedRecordIds: renewalDue.contracts.map((c) => c._id),
      evidence: renewalDue.contracts.slice(0, 6).map((c) => evidence({
        recordType: "Contract", record: c, label: c.contractType, field: "Renewal notice window", value: "Open", explanation: "Renewal notice period has begun.", role,
      })),
      suggestedActions: [], dataRange: "Current window", createdAt: now,
    }));
  }

  const noOwner = computeContractsWithoutOwner(scoped.contracts);
  if (noOwner.count > 0) {
    insights.push(createInsight({
      id: "contract-no-owner", type: "contract_without_renewal_owner", module: "contracts",
      title: "Active Contracts without a renewal owner",
      summary: `${noOwner.count} Signed Contract${noOwner.count === 1 ? " has" : "s have"} no assigned owner.`,
      explanation: "Reads the Contract's ownerId field directly.",
      priority: "Medium",
      confidence: createConfidence("High Confidence", "ownerId is an explicit field."),
      affectedRecordIds: noOwner.contracts.map((c) => c._id),
      evidence: noOwner.contracts.slice(0, 6).map((c) => evidence({
        recordType: "Contract", record: c, label: c.contractType, field: "Owner", value: "Unassigned", explanation: "No owner is assigned to this Contract.", role,
      })),
      suggestedActions: noOwner.contracts.slice(0, 1).map((c) => createSuggestedAction({
        id: `${c._id}-assign-contract-owner`, type: "assign_owner", label: "Assign a renewal owner",
        reason: "An unowned Contract has no one accountable for renewal.", affectedRecordId: c._id, affectedRecordType: "Contract",
        requiredApprover: "Sales Manager",
      })),
      dataRange: "Signed Contracts", createdAt: now,
    }));
  }

  const mismatches = computeContractValueMismatches(scoped.contracts, scoped.orders);
  if (mismatches.count > 0) {
    insights.push(createInsight({
      id: "contract-value-mismatch", type: "contract_value_mismatch", module: "contracts",
      title: "Contract value differs from its source Order",
      summary: `${mismatches.count} Contract${mismatches.count === 1 ? "" : "s"} ${verb(mismatches.count, "has", "have")} a total that no longer matches ${verb(mismatches.count, "its", "their")} source Order.`,
      explanation: "Recomputes both the Contract's and the source Order's line-item totals and compares them.",
      priority: "Medium",
      confidence: createConfidence("High Confidence", "Both totals are recalculated from current line items, not read from a cached field."),
      affectedRecordIds: mismatches.mismatches.map((m) => m.contract._id),
      evidence: mismatches.mismatches.slice(0, 6).map((m) => evidence({
        recordType: "Contract", record: m.contract, label: m.contract.contractType, field: "Value mismatch",
        value: `${moneyFor(role, m.contractTotal.toString())} vs order ${moneyFor(role, m.orderTotal.toString())}`,
        explanation: "Contract total differs from its linked Order's recalculated total.", role,
      })),
      suggestedActions: [], dataRange: "Current records", createdAt: now,
    }));
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Executive summary — assembled from the actual insight list, never from a
// template the calculations didn't produce.
// ---------------------------------------------------------------------------
function buildExecutiveSummary(insights, role, openPipeline, weightedPipeline) {
  const active = insights.filter((i) => !i.dismissed);
  const risks = active.filter((i) => ["sales", "contracts"].includes(i.module) && i.priority !== "Informational");
  const opportunities = active.filter((i) => i.type.startsWith("opp-") || i.type.includes("opportunity") || i.type === "renewal_eligible" || i.type === "repeat_win_companies" || i.type === "dormant_company_prior_revenue" || i.type === "qualified_leads_without_deals" || i.type === "active_companies_without_deals");
  const topRisk = [...risks].sort((a, b) => a.priority === "Critical" ? -1 : b.priority === "Critical" ? 1 : 0)[0];
  const topOpportunity = opportunities[0];
  const urgentAction = active.find((i) => i.suggestedActions?.length > 0 && i.priority === "Critical") || active.find((i) => i.suggestedActions?.length > 0);

  if (active.length === 0) {
    const pipelineText = role === "Checker" ? MASKED_NOTICE : formatByCurrency(openPipeline.valueByCurrency);
    return `Open pipeline is ${pipelineText} across ${openPipeline.count} Deal${openPipeline.count === 1 ? "" : "s"}. No risks, opportunities or data-quality issues were detected in the current scope. This reflects the records you can see, not a guarantee that everything is fine.`;
  }

  const parts = [];
  const pipelineText = role === "Checker" ? MASKED_NOTICE : formatByCurrency(openPipeline.valueByCurrency);
  const weightedText = role === "Checker" ? MASKED_NOTICE : formatByCurrency(weightedPipeline.valueByCurrency);
  parts.push(`Open pipeline is ${pipelineText} across ${openPipeline.count} Deal${openPipeline.count === 1 ? "" : "s"} (${weightedText} weighted). This preview found ${risks.length} sales/contract risk${risks.length === 1 ? "" : "s"} and ${opportunities.length} opportunit${opportunities.length === 1 ? "y" : "ies"} in the current scope.`);
  if (topRisk) parts.push(`The most urgent risk: ${topRisk.summary}`);
  if (topOpportunity) parts.push(`The most valuable opportunity: ${topOpportunity.summary}`);
  if (urgentAction) parts.push(`Recommended next step: ${urgentAction.suggestedActions[0]?.label || "review the affected records"}.`);
  parts.push(role === "Checker" ? "Financial figures are masked for this role — see an authorized role for exact values." : "All figures above are calculated directly from the records you can see.");
  return parts.join(" ");
}

function buildLimitations(scoped, role) {
  const limitations = [...STANDARD_LIMITATIONS];
  if (role === "Checker") {
    limitations.push(
      "The Auditor / Checker role does not have direct access to CRM/Sales records in this app — the same boundary enforced elsewhere in the product — so most insight types cannot be calculated for this role.",
      "Monetary figures are masked for the Auditor / Checker role and shown only to authorized roles."
    );
  } else if (scoped.deals.length === 0) {
    limitations.push("No Deals are visible in the current scope — sales-risk and opportunity insights cannot be calculated.");
  }
  return limitations;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export function generateAnalysisPreview(request, sharedData) {
  const scoped = scopeSharedData(sharedData, request);
  const now = new Date().toISOString();

  const insights = [
    ...buildSalesRiskInsights(scoped, request.role, now),
    ...buildSalesOpportunityInsights(scoped, request.role, now),
    ...buildActivityInsights(scoped, request.role, now),
    ...buildDataQualityInsights(scoped, request.role, now),
    ...buildContractInsights(scoped, request.role, now),
  ];

  const dataFreshness = computeDataFreshness(scoped);
  const openPipeline = computeOpenPipeline(scoped.deals);
  const weightedPipeline = computeWeightedPipeline(scoped.deals);

  const overallConfidence = (() => {
    if (insights.length === 0) return createConfidence("Insufficient Data", "No insights were generated in the current scope to assess.");
    const high = insights.filter((i) => i.confidence.level === "High Confidence").length;
    return createConfidence(
      high / insights.length >= 0.6 ? "High Confidence" : "Medium Confidence",
      `${high} of ${insights.length} insights are High Confidence, based directly on explicit record fields rather than inference.`
    );
  })();

  return createAnalysisResponse({
    analysisId: `preview-${Date.now()}`,
    executiveSummary: buildExecutiveSummary(insights, request.role, openPipeline, weightedPipeline),
    insights,
    risks: insights.filter((i) => ["sales", "contracts"].includes(i.module)),
    opportunities: insights.filter((i) => i.type.includes("opp") || ["renewal_eligible", "repeat_win_companies", "dormant_company_prior_revenue", "qualified_leads_without_deals", "active_companies_without_deals"].includes(i.type)),
    suggestedActions: insights.flatMap((i) => i.suggestedActions),
    evidence: insights.flatMap((i) => i.evidence),
    confidence: overallConfidence,
    dataDate: dataFreshness,
    limitations: buildLimitations(scoped, request.role),
    generatedAt: now,
    providerStatus: createProviderStatus(),
  });
}

export function computeCompactMetrics(response) {
  const active = response.insights.filter((i) => !i.dismissed);
  return {
    criticalRisks: active.filter((i) => i.priority === "Critical").length,
    opportunities: response.opportunities.filter((i) => !i.dismissed).length,
    suggestedActions: response.suggestedActions.length,
    recordsNeedingAttention: new Set(active.flatMap((i) => i.affectedRecordIds)).size,
    dataQualityIssues: active.filter((i) => i.module === "data-quality").length,
    highConfidenceShare: active.length ? Math.round((active.filter((i) => i.confidence.level === "High Confidence").length / active.length) * 100) : null,
  };
}

// Exported for aiCopilotEngine.js — a chat question is answered by running
// the exact same RBAC-respecting scope narrowing and evidence-building as a
// full analysis, just for one selector at a time instead of all of them.
export { ownerName, scopeSharedData, evidence, lastActivityFns, computeDataFreshness, moneyFor, MASKED_NOTICE };
