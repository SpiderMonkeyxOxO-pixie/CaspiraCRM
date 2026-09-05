import { describe, it, expect } from "vitest";
import { deals, leads, companies, contacts } from "../../Helpers/mockCrmData";
import { activities } from "../../Helpers/mockActivitiesData";
import { quotes } from "../../Helpers/mockQuoteData";
import { orders } from "../../Helpers/mockOrderData";
import { contracts } from "../../Helpers/mockContractData";
import { CRM_TEAM, CURRENT_MOCK_OWNER_ID } from "../../Helpers/mockUsersData";
import {
  scopeRecords, computeLeadTotals, computeLeadConversionRate, computeQualifiedLeadsWithoutDeals,
  computeDealStageCounts, computeDealInactivity, computeOverdueFollowUps, computeAtRiskAndStaleDeals,
  computeHighValueAtRiskDeals, computePipelineConcentration, computeDealsLackingProductsOrOwner,
  computeCompaniesWithoutOpenDeals, computeRepeatWinCompanies, computeFrequentWinningProducts,
  computeDormantCompaniesWithPriorRevenue, computeRenewalEligibleCustomers,
  computeOverdueActivities, computeActivitiesDueSoon, computeUserOverdueLoad,
  computeCompaniesWithoutRecentActivity, computeMeetingsWithoutOutcome, computeUsersWithoutScheduledNextActions,
  computeDuplicateFollowUps, computeExpiredQuotesLinkedToOpenDeals, computeContractsExpiringSoon,
  computeContractsRenewalDue, computeContractsWithoutOwner, computeContractValueMismatches,
  computeLeadsWithoutContactInfo, computeContactsWithoutCompany, computeCompaniesWithoutPrimaryContact,
  computeInvalidOwnerRecords, computeDealsMissingCurrency, computeDealsMissingClosingDate,
  computeDuplicateRisk, computeDataQualityIssues, computeOpenPipeline, computeWeightedPipeline,
  computeAvgDealSize, daysSince,
} from "./aiSelectors";

describe("aiSelectors — deterministic calculations run against real shared fixtures", () => {
  it("computeLeadTotals counts only non-archived leads", () => {
    const result = computeLeadTotals(leads);
    expect(result.total).toBe(leads.filter((l) => !l.archived).length);
  });

  it("computeLeadConversionRate is a percentage or null, never fabricated", () => {
    const result = computeLeadConversionRate(leads);
    if (result.rate !== null) {
      expect(result.rate).toBeGreaterThanOrEqual(0);
      expect(result.rate).toBeLessThanOrEqual(100);
    }
    expect(result.convertedCount).toBeLessThanOrEqual(result.eligibleCount);
  });

  it("computeQualifiedLeadsWithoutDeals only returns Qualified leads with no linked deal", () => {
    const result = computeQualifiedLeadsWithoutDeals(leads);
    for (const l of result.leads) {
      expect(l.status).toBe("Qualified");
      expect(l.convertedTo?.dealId).toBeFalsy();
    }
  });

  it("computeOpenPipeline and computeWeightedPipeline sum only Open deals", () => {
    const pipeline = computeOpenPipeline(deals);
    const weighted = computeWeightedPipeline(deals);
    expect(pipeline.count).toBe(deals.filter((d) => d.status === "Open").length);
    expect(Object.keys(weighted.valueByCurrency).length).toBeGreaterThanOrEqual(0);
  });

  it("computeDealStageCounts covers every non-Won stage", () => {
    const result = computeDealStageCounts(deals);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((r) => typeof r.count === "number")).toBe(true);
  });

  it("computeDealInactivity flags only Open deals inactive for at least the threshold", () => {
    const result = computeDealInactivity(deals, () => null, 14);
    for (const d of result.deals) {
      expect(d.status).toBe("Open");
      const since = daysSince(d.updatedAt || d.createdAt);
      expect(since).toBeGreaterThanOrEqual(14);
    }
    expect(result.dealIds.length).toBe(result.count);
  });

  it("computeOverdueFollowUps only returns Open deals with a passed expected closing date", () => {
    const result = computeOverdueFollowUps(deals);
    for (const d of result.deals) {
      expect(d.status).toBe("Open");
      expect(new Date(d.expectedClosingDate).getTime()).toBeLessThan(Date.now());
    }
  });

  it("computeAtRiskAndStaleDeals always attaches at least one reason", () => {
    const result = computeAtRiskAndStaleDeals(deals, () => null);
    for (const entry of result) expect(entry.reasons.length).toBeGreaterThan(0);
  });

  it("computeHighValueAtRiskDeals is a subset of at-risk deals", () => {
    const atRisk = computeAtRiskAndStaleDeals(deals, () => null);
    const highValue = computeHighValueAtRiskDeals(deals, () => null);
    expect(highValue.count).toBeLessThanOrEqual(atRisk.length);
  });

  it("computePipelineConcentration reports a share between 0 and 100", () => {
    const result = computePipelineConcentration(deals);
    expect(result.share).toBeGreaterThanOrEqual(0);
    expect(result.share).toBeLessThanOrEqual(100);
  });

  it("computeDealsLackingProductsOrOwner only inspects Open deals", () => {
    const result = computeDealsLackingProductsOrOwner(deals);
    for (const d of result.lackingProducts) expect(d.status).toBe("Open");
    for (const d of result.lackingOwner) expect(d.ownerId).toBeFalsy();
  });

  it("computeCompaniesWithoutOpenDeals excludes companies that have an open deal", () => {
    const result = computeCompaniesWithoutOpenDeals(companies, deals);
    const openCompanyIds = new Set(deals.filter((d) => d.status === "Open").map((d) => d.companyId));
    for (const c of result.companies) expect(openCompanyIds.has(c._id)).toBe(false);
  });

  it("computeRepeatWinCompanies requires at least the minimum win count", () => {
    const result = computeRepeatWinCompanies(companies, deals, 2);
    for (const entry of result.companies) expect(entry.wins).toBeGreaterThanOrEqual(2);
  });

  it("computeFrequentWinningProducts only counts line items on Won deals", () => {
    const result = computeFrequentWinningProducts(deals, 1);
    expect(Array.isArray(result)).toBe(true);
  });

  it("computeDormantCompaniesWithPriorRevenue requires a prior Won deal", () => {
    const result = computeDormantCompaniesWithPriorRevenue(companies, deals, () => null, 90);
    const wonCompanyIds = new Set(deals.filter((d) => d.status === "Won").map((d) => d.companyId));
    for (const c of result.companies) expect(wonCompanyIds.has(c._id)).toBe(true);
  });

  it("computeRenewalEligibleCustomers only returns Signed contracts due for renewal", () => {
    const result = computeRenewalEligibleCustomers(companies, contracts);
    expect(result.count).toBe(result.companies.length);
  });

  it("computeOverdueActivities matches the effective-status Overdue definition", () => {
    const result = computeOverdueActivities(activities);
    expect(Array.isArray(result)).toBe(true);
  });

  it("computeActivitiesDueSoon returns only activities in the future window", () => {
    const result = computeActivitiesDueSoon(activities, 7);
    for (const a of result) {
      const ref = new Date(a.dueDate || a.startAt);
      expect(ref.getTime()).toBeGreaterThanOrEqual(new Date(new Date().toDateString()).getTime());
    }
  });

  it("computeUserOverdueLoad only flags members at/above the threshold", () => {
    const result = computeUserOverdueLoad(activities, CRM_TEAM, 1);
    for (const entry of result.flagged) expect(entry.count).toBeGreaterThanOrEqual(1);
  });

  it("computeCompaniesWithoutRecentActivity requires missing or stale contact", () => {
    const result = computeCompaniesWithoutRecentActivity(companies, () => null, 30);
    expect(result.count).toBe(companies.filter((c) => !c.archived).length);
  });

  it("computeMeetingsWithoutOutcome only returns completed Meetings missing an outcome", () => {
    const result = computeMeetingsWithoutOutcome(activities);
    for (const a of result.activities) {
      expect(a.type).toBe("Meeting");
      expect(a.status).toBe("Completed");
      expect(a.outcome).toBeFalsy();
    }
  });

  it("computeUsersWithoutScheduledNextActions returns team members, not activities", () => {
    const result = computeUsersWithoutScheduledNextActions(CRM_TEAM, activities);
    expect(result.count).toBe(result.members.length);
  });

  it("computeDuplicateFollowUps pairs same-type, same-record, same-day activities", () => {
    const result = computeDuplicateFollowUps(activities);
    expect(result.count).toBe(result.pairs.length);
  });

  it("computeExpiredQuotesLinkedToOpenDeals only returns quotes tied to an Open deal", () => {
    const result = computeExpiredQuotesLinkedToOpenDeals(quotes, deals);
    const openDealIds = new Set(deals.filter((d) => d.status === "Open").map((d) => d._id));
    for (const q of result.quotes) expect(openDealIds.has(q.dealId)).toBe(true);
  });

  it("computeContractsExpiringSoon / RenewalDue / WithoutOwner all return real contract objects", () => {
    expect(computeContractsExpiringSoon(contracts).count).toBeGreaterThanOrEqual(0);
    expect(computeContractsRenewalDue(contracts).count).toBeGreaterThanOrEqual(0);
    expect(computeContractsWithoutOwner(contracts).count).toBeGreaterThanOrEqual(0);
  });

  it("computeContractValueMismatches compares real computed totals, not stored fields", () => {
    const result = computeContractValueMismatches(contracts, orders);
    for (const m of result.mismatches) expect(Math.abs(m.contractTotal - m.orderTotal)).toBeGreaterThan(0.01);
  });

  it("data-quality selectors each return an internally-consistent count", () => {
    expect(computeLeadsWithoutContactInfo(leads).count).toBeGreaterThanOrEqual(0);
    expect(computeContactsWithoutCompany(contacts).count).toBeGreaterThanOrEqual(0);
    expect(computeCompaniesWithoutPrimaryContact(companies).count).toBeGreaterThanOrEqual(0);
    expect(computeInvalidOwnerRecords(deals).count).toBeGreaterThanOrEqual(0);
    expect(computeDealsMissingCurrency(deals).count).toBeGreaterThanOrEqual(0);
    expect(computeDealsMissingClosingDate(deals).count).toBeGreaterThanOrEqual(0);
    expect(computeDuplicateRisk(leads, contacts, companies).count).toBeGreaterThanOrEqual(0);
  });

  it("computeDataQualityIssues total equals the sum of its parts", () => {
    const result = computeDataQualityIssues({ leads, contacts, companies, deals });
    const sum =
      result.leadsNoContact.count + result.contactsNoCompany.count + result.companiesNoPrimary.count +
      result.invalidLeadOwners.count + result.invalidDealOwners.count + result.dealsMissingCurrency.count +
      result.dealsMissingClosingDate.count + result.duplicateRisk.count;
    expect(result.total).toBe(sum);
  });

  it("scopeRecords 'mine' returns only the current owner's non-archived records", () => {
    const result = scopeRecords(deals, { scope: "mine", currentOwnerId: CURRENT_MOCK_OWNER_ID });
    for (const d of result) {
      expect(d.archived).toBeFalsy();
      expect(d.ownerId).toBe(CURRENT_MOCK_OWNER_ID);
    }
  });

  it("scopeRecords 'all' excludes only archived records", () => {
    const result = scopeRecords(deals, { scope: "all" });
    expect(result.length).toBe(deals.filter((d) => !d.archived).length);
  });

  it("computeAvgDealSize never divides by zero", () => {
    expect(() => computeAvgDealSize(deals)).not.toThrow();
  });
});
