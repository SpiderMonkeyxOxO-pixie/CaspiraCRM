// Deterministic, pure calculation functions for the AI Intelligence Center.
//
// Every number an AI insight ever states — "Five Deals worth $450,000", "18
// days", "3 duplicate pairs" — comes from a function in this file, never
// from fixture text written to look AI-generated. aiInsightEngine.js reads
// these results and turns them into insight cards; it never invents a
// number of its own.
//
// Wherever a calculation already exists for the CRM Dashboard or a
// completed module (pipeline value, deal risk reasons, contract renewal
// windows, duplicate clusters), this file reuses it instead of
// recalculating the same thing a second, possibly-inconsistent way.
import { DEAL_STAGES } from "../../redux/crm/dealsSlice";
import { computeDealRiskReasons, isStaleDeal, formatByCurrency } from "../CRM/Deals/dealUtils";
import { effectiveStatus as activityEffectiveStatus } from "../../redux/crm/activitiesSlice";
import {
  sumByCurrency, computeOpenPipeline, computeWeightedPipeline, computeAvgDealSize,
  computeAtRiskAndStaleDeals, computeOverdueActivities, computeCompaniesNeedingAttention,
} from "../CRM/Dashboard/dashboardSelectors";
import { computeQuoteTotals, getEffectiveStatus as getQuoteStatus, isExpiringSoon as isQuoteExpiringSoon } from "../../Helpers/mockQuoteData";
import { computeOrderTotals, getEffectiveStatus as getOrderStatus } from "../../Helpers/mockOrderData";
import { computeContractTotals, getEffectiveStatus as getContractStatus, isRenewalDue, isExpiringSoon as isContractExpiringSoon } from "../../Helpers/mockContractData";
import { findCandidateClusters } from "../CRM/Duplicates/duplicateMatching";
import { isValidOwner } from "../../Helpers/mockUsersData";

export { sumByCurrency, computeOpenPipeline, computeWeightedPipeline, formatByCurrency };

const DAY_MS = 24 * 60 * 60 * 1000;
const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS) : null);
const daysUntil = (iso) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / DAY_MS) : null);

// ---------------------------------------------------------------------------
// Scope — narrows a shared record array to what the active AI view/role
// authorizes, BEFORE any other selector below ever sees the data. This is
// what makes "unauthorized records excluded before calculation" true: an
// executive-only deal simply never enters the arrays these functions sum.
// ---------------------------------------------------------------------------
export function scopeRecords(records, { scope, currentOwnerId, team, ownerField = "ownerId", teamField = "assignedTeam" }) {
  return records.filter((r) => {
    if (r.archived) return false;
    if (scope === "mine") return r[ownerField] === currentOwnerId;
    if (scope === "team" || scope === "department") {
      if (team) return r[teamField] === team;
      return true; // no specific team selected — every team within the permitted department
    }
    return true; // "all" — executive / data-quality views
  });
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------
export function computeLeadTotals(leads) {
  const active = leads.filter((l) => !l.archived);
  return { total: active.length, leads: active };
}

const LEAD_NON_CONVERTED_TERMINAL = ["Unqualified", "Duplicate", "Spam"];
export function computeLeadConversionRate(leads) {
  const eligible = leads.filter((l) => !l.archived && !LEAD_NON_CONVERTED_TERMINAL.includes(l.status));
  const converted = eligible.filter((l) => l.status === "Converted");
  return {
    rate: eligible.length ? Math.round((converted.length / eligible.length) * 1000) / 10 : null,
    convertedCount: converted.length,
    eligibleCount: eligible.length,
  };
}

export function computeQualifiedLeadsWithoutDeals(leads) {
  const matches = leads.filter((l) => !l.archived && l.status === "Qualified" && !l.convertedTo?.dealId);
  return { count: matches.length, leads: matches };
}

// ---------------------------------------------------------------------------
// Deals / Pipeline
// ---------------------------------------------------------------------------
export { computeAvgDealSize };

export function computeDealStageCounts(deals) {
  return DEAL_STAGES.filter((s) => s !== "Won").map((stage) => ({
    stage, count: deals.filter((d) => d.status === "Open" && d.stage === stage).length,
  }));
}

// The canonical "Deal inactivity" calculation — the spec's own worked
// example ("Five Deals worth $450,000 have no activity during the last 14
// days") is exactly this function's output at days=14.
export function computeDealInactivity(deals, lastActivityAtFn, days = 14) {
  const open = deals.filter((d) => d.status === "Open");
  const affected = open.filter((d) => {
    const reference = (lastActivityAtFn && lastActivityAtFn(d._id)) || d.updatedAt || d.createdAt;
    const since = daysSince(reference);
    return since !== null && since >= days;
  });
  return {
    count: affected.length,
    days,
    valueByCurrency: sumByCurrency(affected, (d) => d.value),
    dealIds: affected.map((d) => d._id),
    deals: affected,
  };
}

export function computeOverdueFollowUps(deals) {
  const open = deals.filter((d) => d.status === "Open");
  const overdue = open.filter((d) => d.expectedClosingDate && new Date(d.expectedClosingDate) < new Date());
  return { count: overdue.length, valueByCurrency: sumByCurrency(overdue, (d) => d.value), deals: overdue };
}

export { computeAtRiskAndStaleDeals, isStaleDeal, computeDealRiskReasons };

export function computeHighValueAtRiskDeals(deals, lastActivityAtFn) {
  const atRisk = computeAtRiskAndStaleDeals(deals, lastActivityAtFn);
  const avgByCurrency = computeAvgDealSize(deals);
  const highValue = atRisk.filter(({ deal }) => deal.value >= (avgByCurrency[deal.currency || "USD"] || 0));
  return { count: highValue.length, entries: highValue, valueByCurrency: sumByCurrency(highValue.map((x) => x.deal), (d) => d.value) };
}

export function computePipelineConcentration(deals, threshold = 0.4) {
  const open = deals.filter((d) => d.status === "Open");
  const totalsByCompany = new Map();
  for (const d of open) {
    const cur = d.currency || "USD";
    const key = d.companyId || "unassigned";
    if (!totalsByCompany.has(key)) totalsByCompany.set(key, {});
    const entry = totalsByCompany.get(key);
    entry[cur] = (entry[cur] || 0) + (d.value || 0);
  }
  const totalByCurrency = sumByCurrency(open, (d) => d.value);
  let concentratedCompanyId = null;
  let concentratedShare = 0;
  let concentratedCurrency = null;
  for (const [companyId, byCurrency] of totalsByCompany.entries()) {
    for (const [cur, amount] of Object.entries(byCurrency)) {
      const total = totalByCurrency[cur] || 0;
      const share = total ? amount / total : 0;
      if (share > concentratedShare) {
        concentratedShare = share;
        concentratedCompanyId = companyId;
        concentratedCurrency = cur;
      }
    }
  }
  return {
    isConcentrated: concentratedShare >= threshold && concentratedCompanyId && concentratedCompanyId !== "unassigned",
    companyId: concentratedCompanyId,
    share: Math.round(concentratedShare * 1000) / 10,
    currency: concentratedCurrency,
    amount: concentratedCompanyId ? totalsByCompany.get(concentratedCompanyId)?.[concentratedCurrency] || 0 : 0,
  };
}

export function computeDealsLackingProductsOrOwner(deals) {
  const open = deals.filter((d) => d.status === "Open");
  const lackingProducts = open.filter((d) => !(d.lineItems && d.lineItems.length > 0));
  const lackingOwner = open.filter((d) => !d.ownerId);
  return { lackingProducts, lackingOwner };
}

export function computeCompaniesWithoutOpenDeals(companies, deals) {
  const openCompanyIds = new Set(deals.filter((d) => d.status === "Open").map((d) => d.companyId));
  const matches = companies.filter((c) => !c.archived && c.customerStatus === "Active" && !openCompanyIds.has(c._id));
  return { count: matches.length, companies: matches };
}

export function computeRepeatWinCompanies(companies, deals, minWins = 2) {
  const winsByCompany = new Map();
  for (const d of deals) {
    if (d.status !== "Won") continue;
    winsByCompany.set(d.companyId, (winsByCompany.get(d.companyId) || 0) + 1);
  }
  const matches = companies.filter((c) => (winsByCompany.get(c._id) || 0) >= minWins);
  return { count: matches.length, companies: matches.map((c) => ({ company: c, wins: winsByCompany.get(c._id) })) };
}

export function computeFrequentWinningProducts(deals, minAppearances = 2) {
  const tally = new Map();
  for (const d of deals) {
    if (d.status !== "Won") continue;
    for (const item of d.lineItems || []) {
      const key = item.name || item.productId;
      if (!key) continue;
      tally.set(key, (tally.get(key) || 0) + 1);
    }
  }
  return [...tally.entries()].filter(([, count]) => count >= minAppearances).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

export function computeDormantCompaniesWithPriorRevenue(companies, deals, lastActivityAtFn, days = 90) {
  const wonCompanyIds = new Set(deals.filter((d) => d.status === "Won").map((d) => d.companyId));
  const matches = companies.filter((c) => {
    if (c.archived || !wonCompanyIds.has(c._id)) return false;
    const lastActivity = lastActivityAtFn ? lastActivityAtFn(c._id) : null;
    const since = daysSince(lastActivity);
    return since === null || since >= days;
  });
  return { count: matches.length, companies: matches };
}

export function computeRenewalEligibleCustomers(companies, contracts) {
  const signedByCompany = new Map();
  for (const c of contracts) {
    if (getContractStatus(c) === "Signed" && isRenewalDue(c)) {
      if (!signedByCompany.has(c.companyId)) signedByCompany.set(c.companyId, []);
      signedByCompany.get(c.companyId).push(c);
    }
  }
  const matches = companies.filter((c) => signedByCompany.has(c._id));
  return { count: matches.length, companies: matches.map((c) => ({ company: c, contracts: signedByCompany.get(c._id) })) };
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------
export { computeOverdueActivities };

export function computeActivitiesDueSoon(activities, days = 7, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + (days + 1) * DAY_MS);
  return activities.filter((a) => {
    const ref = a.dueDate || a.startAt;
    if (!ref || ["Completed", "Cancelled"].includes(a.status)) return false;
    const d = new Date(ref);
    return d >= start && d < end;
  });
}

export function computeUserOverdueLoad(activities, team, threshold = 3) {
  const overdue = computeOverdueActivities(activities);
  const byOwner = new Map();
  for (const a of overdue) byOwner.set(a.ownerId, (byOwner.get(a.ownerId) || 0) + 1);
  const flagged = team
    .map((member) => ({ member, count: byOwner.get(member.id) || 0 }))
    .filter((x) => x.count >= threshold);
  return { flagged, overdueActivities: overdue };
}

export { computeCompaniesNeedingAttention };

export function computeCompaniesWithoutRecentActivity(companies, lastActivityAtFn, days = 30) {
  const matches = [];
  for (const c of companies) {
    if (c.archived) continue;
    const lastActivity = lastActivityAtFn ? lastActivityAtFn(c._id) : null;
    const since = daysSince(lastActivity);
    if (since === null || since >= days) matches.push({ company: c, lastActivity, daysSinceContact: since });
  }
  return { count: matches.length, companies: matches };
}

export function computeMeetingsWithoutOutcome(activities) {
  const matches = activities.filter((a) => a.type === "Meeting" && a.status === "Completed" && !a.outcome);
  return { count: matches.length, activities: matches };
}

export function computeUsersWithoutScheduledNextActions(team, activities, now = new Date()) {
  const upcoming = new Set(
    activities
      .filter((a) => {
        const ref = a.dueDate || a.startAt;
        return ref && new Date(ref) >= now && !["Completed", "Cancelled"].includes(a.status);
      })
      .map((a) => a.ownerId)
  );
  const matches = team.filter((member) => !upcoming.has(member.id));
  return { count: matches.length, members: matches };
}

export function computeDuplicateFollowUps(activities) {
  const seen = new Map();
  const duplicates = [];
  for (const a of activities) {
    if (!["Follow-up", "Call"].includes(a.type) || !a.relatedRecordId) continue;
    const dueDay = a.dueDate ? new Date(a.dueDate).toDateString() : null;
    const key = `${a.relatedRecordType}:${a.relatedRecordId}:${a.type}:${dueDay}`;
    if (seen.has(key)) duplicates.push([seen.get(key), a]);
    else seen.set(key, a);
  }
  return { count: duplicates.length, pairs: duplicates };
}

// ---------------------------------------------------------------------------
// Quotes / Orders
// ---------------------------------------------------------------------------
export { computeQuoteTotals, computeOrderTotals };

export function computeExpiredQuotesLinkedToOpenDeals(quotes, deals) {
  const openDealIds = new Set(deals.filter((d) => d.status === "Open").map((d) => d._id));
  const matches = quotes.filter((q) => q.dealId && openDealIds.has(q.dealId) && (getQuoteStatus(q) === "Expired" || isQuoteExpiringSoon(q)));
  return { count: matches.length, quotes: matches };
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------
export function computeContractsExpiringSoon(contracts) {
  const matches = contracts.filter((c) => isContractExpiringSoon(c));
  return { count: matches.length, contracts: matches };
}

export function computeContractsRenewalDue(contracts) {
  const matches = contracts.filter((c) => isRenewalDue(c));
  return { count: matches.length, contracts: matches };
}

export function computeContractsWithoutOwner(contracts) {
  const matches = contracts.filter((c) => getContractStatus(c) === "Signed" && !c.ownerId);
  return { count: matches.length, contracts: matches };
}

export function computeContractValueMismatches(contracts, orders) {
  const orderById = new Map(orders.map((o) => [o._id, o]));
  const matches = [];
  for (const c of contracts) {
    if (!c.sourceOrderId) continue;
    const order = orderById.get(c.sourceOrderId);
    if (!order) continue;
    const contractTotal = computeContractTotals(c).grandTotal;
    const orderTotal = computeOrderTotals(order).grandTotal;
    if (Math.abs(contractTotal - orderTotal) > 0.01) matches.push({ contract: c, order, contractTotal, orderTotal });
  }
  return { count: matches.length, mismatches: matches };
}
export { getOrderStatus, getQuoteStatus, getContractStatus };

// ---------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------
export function computeLeadsWithoutContactInfo(leads) {
  const matches = leads.filter((l) => !l.archived && !l.email && !l.phone);
  return { count: matches.length, leads: matches };
}

export function computeContactsWithoutCompany(contacts) {
  const matches = contacts.filter((c) => !c.companyId);
  return { count: matches.length, contacts: matches };
}

export function computeCompaniesWithoutPrimaryContact(companies) {
  const matches = companies.filter((c) => !c.archived && !c.primaryContactId);
  return { count: matches.length, companies: matches };
}

export function computeInvalidOwnerRecords(records) {
  const matches = records.filter((r) => r.ownerId && !isValidOwner(r.ownerId));
  return { count: matches.length, records: matches };
}

export function computeDealsMissingCurrency(deals) {
  const matches = deals.filter((d) => d.status === "Open" && !d.currency);
  return { count: matches.length, deals: matches };
}

export function computeDealsMissingClosingDate(deals) {
  const matches = deals.filter((d) => d.status === "Open" && !d.expectedClosingDate);
  return { count: matches.length, deals: matches };
}

export function computeDuplicateRisk(leads, contacts, companies) {
  const leadClusters = findCandidateClusters("lead", leads.filter((l) => !l.archived));
  const contactClusters = findCandidateClusters("contact", contacts);
  const companyClusters = findCandidateClusters("company", companies.filter((c) => !c.archived));
  const all = [...leadClusters, ...contactClusters, ...companyClusters];
  return { count: all.length, clusters: all };
}

export function computeDataQualityIssues({ leads, contacts, companies, deals }) {
  const leadsNoContact = computeLeadsWithoutContactInfo(leads);
  const contactsNoCompany = computeContactsWithoutCompany(contacts);
  const companiesNoPrimary = computeCompaniesWithoutPrimaryContact(companies);
  const invalidLeadOwners = computeInvalidOwnerRecords(leads);
  const invalidDealOwners = computeInvalidOwnerRecords(deals);
  const dealsMissingCurrency = computeDealsMissingCurrency(deals);
  const dealsMissingClosingDate = computeDealsMissingClosingDate(deals);
  const duplicateRisk = computeDuplicateRisk(leads, contacts, companies);
  const total =
    leadsNoContact.count + contactsNoCompany.count + companiesNoPrimary.count +
    invalidLeadOwners.count + invalidDealOwners.count + dealsMissingCurrency.count +
    dealsMissingClosingDate.count + duplicateRisk.count;
  return {
    total, leadsNoContact, contactsNoCompany, companiesNoPrimary,
    invalidLeadOwners, invalidDealOwners, dealsMissingCurrency, dealsMissingClosingDate, duplicateRisk,
  };
}

export { daysSince, daysUntil };
export { activityEffectiveStatus };
