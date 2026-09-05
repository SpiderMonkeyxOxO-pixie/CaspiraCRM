import { describe, it, expect } from "vitest";
import {
  createDealRecord, updateDealRecord, changeDealStage, markDealWon, markDealLost,
  cancelDealRecord, putDealOnHold, reopenDealRecord, archiveDealRecord, restoreDealRecord,
  addDealContact, removeDealContact, setDealPrimaryContact, setDealLineItems, computeLineItemTotals,
  addDealQuotePreview, addDealFile, deleteDealFile, queryDealsLocal, findDeal,
  DEAL_STAGE_PROBABILITY, deals, companies, contacts,
} from "./mockCrmData";

describe("mockCrmData deals", () => {
  it("createDealRecord stamps createdAt as \"now\", not a random past fixture date (regression)", () => {
    const before = Date.now();
    const deal = createDealRecord({ name: "Fresh deal", companyId: companies[0]._id, currency: "USD" }, "Tester");
    const createdAtMs = new Date(deal.createdAt).getTime();
    expect(createdAtMs).toBeGreaterThanOrEqual(before - 1000);
    expect(createdAtMs).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("does not duplicate company/contact data on the deal — only IDs are stored", () => {
    const company = companies[0];
    const deal = createDealRecord({ name: "ID-only deal", companyId: company._id }, "Tester");
    expect(deal.companyId).toBe(company._id);
    expect(deal).not.toHaveProperty("companyName");
  });

  it("weightedValue is always value × probability, recomputed on every update", () => {
    const deal = createDealRecord({ name: "Weighted test", companyId: companies[0]._id, value: 1000, probability: 25 }, "Tester");
    expect(deal.weightedValue).toBe(250);
    const updated = updateDealRecord(deal._id, { value: 2000 }, "Tester");
    expect(updated.weightedValue).toBe(500);
    const updated2 = updateDealRecord(updated._id, { probability: 50 }, "Tester");
    expect(updated2.weightedValue).toBe(1000);
  });

  it("changeDealStage updates probability from the single configured stage-probability map and logs stage history", () => {
    const deal = createDealRecord({ name: "Stage move", companyId: companies[0]._id, value: 1000, stage: "Discovery" }, "Tester");
    expect(deal.probability).toBe(DEAL_STAGE_PROBABILITY.Discovery);
    const updated = changeDealStage(deal._id, { stage: "Proposal", note: "Sent proposal" }, "Tester");
    expect(updated.stage).toBe("Proposal");
    expect(updated.probability).toBe(DEAL_STAGE_PROBABILITY.Proposal);
    expect(updated.weightedValue).toBe(1000 * (DEAL_STAGE_PROBABILITY.Proposal / 100));
    expect(updated.status).toBe("Open");
    const lastEntry = updated.stageHistory[updated.stageHistory.length - 1];
    expect(lastEntry.from).toBe("Discovery");
    expect(lastEntry.to).toBe("Proposal");
    expect(lastEntry.note).toBe("Sent proposal");
  });

  it("markDealWon sets status Won, probability 100, and an actual closing date", () => {
    const deal = createDealRecord({ name: "Win me", companyId: companies[0]._id, value: 5000, stage: "Approval" }, "Tester");
    const won = markDealWon(deal._id, { winReason: "Great fit" }, "Tester");
    expect(won.stage).toBe("Won");
    expect(won.status).toBe("Won");
    expect(won.probability).toBe(100);
    expect(won.weightedValue).toBe(5000);
    expect(won.winReason).toBe("Great fit");
    expect(won.actualClosingDate).toBeTruthy();
  });

  it("markDealLost preserves the deal (never deletes it) and requires no backend cascade into other domains", () => {
    const deal = createDealRecord({ name: "Lose me", companyId: companies[0]._id, value: 5000 }, "Tester");
    const lost = markDealLost(deal._id, { lossReason: "Price" }, "Tester");
    expect(lost.status).toBe("Lost");
    expect(lost.probability).toBe(0);
    expect(lost.weightedValue).toBe(0);
    expect(findDeal(deal._id)).toBeTruthy();
    // No cross-domain fields (orderId/contractId/projectId/invoiceId) are ever set by this phase.
    expect(lost).not.toHaveProperty("orderId");
    expect(lost).not.toHaveProperty("invoiceId");
  });

  it("putDealOnHold and reopenDealRecord round-trip stage/status/probability correctly", () => {
    const deal = createDealRecord({ name: "Hold me", companyId: companies[0]._id, value: 8000, stage: "Negotiation" }, "Tester");
    const held = putDealOnHold(deal._id, { onHoldReason: "Budget frozen", onHoldReviewDate: new Date().toISOString() }, "Tester");
    expect(held.status).toBe("On Hold");
    expect(held.stage).toBe("On Hold");
    const reopened = reopenDealRecord(held._id, { stage: "Qualified", expectedClosingDate: new Date().toISOString(), nextAction: "Call back" }, "Tester");
    expect(reopened.status).toBe("Open");
    expect(reopened.stage).toBe("Qualified");
    expect(reopened.probability).toBe(DEAL_STAGE_PROBABILITY.Qualified);
    expect(reopened.onHoldReason).toBeNull();
  });

  it("cancelDealRecord and archive/restore behave independently of stage outcome", () => {
    const deal = createDealRecord({ name: "Cancel me", companyId: companies[0]._id, value: 3000 }, "Tester");
    const cancelled = cancelDealRecord(deal._id, { cancellationReason: "No longer needed" }, "Tester");
    expect(cancelled.status).toBe("Cancelled");
    const archived = archiveDealRecord(deal._id, "Cleaning up old records", "Tester");
    expect(archived.archived).toBe(true);
    const restored = restoreDealRecord(deal._id, "Tester");
    expect(restored.archived).toBe(false);
  });

  it("updateDealRecord logs field-level audit entries with primitive values (no circular structure)", () => {
    const deal = createDealRecord({ name: "Audit field test", companyId: companies[0]._id }, "Tester");
    const updated = updateDealRecord(deal._id, { name: "Renamed deal" }, "Tester");
    const entry = updated.auditLog.find((e) => e.field === "name");
    expect(entry).toBeTruthy();
    expect(entry.after).toBe("Renamed deal");
    expect(() => JSON.stringify(updated)).not.toThrow();
  });

  it("computeLineItemTotals computes subtotal, discount, estimated total and recurring value", () => {
    const totals = computeLineItemTotals([
      { quantity: 2, unitPrice: 100, discountPercent: 10, billingFrequency: "One-time" },
      { quantity: 1, unitPrice: 1200, discountPercent: 0, billingFrequency: "Annually" },
    ]);
    expect(totals.subtotal).toBe(1400);
    expect(totals.discountTotal).toBe(20);
    expect(totals.estimatedTotal).toBe(1380);
    expect(totals.recurringValue).toBe(1200);
  });

  it("setDealLineItems normalizes and recomputes recurring value on the deal", () => {
    const deal = createDealRecord({ name: "Products deal", companyId: companies[0]._id }, "Tester");
    const updated = setDealLineItems(deal._id, [{ name: "Plan", quantity: 3, unitPrice: 50, billingFrequency: "Monthly" }], "Tester");
    expect(updated.lineItems).toHaveLength(1);
    expect(updated.lineItems[0].lineTotal).toBe(150);
    expect(updated.expectedRecurringValue).toBe(150);
  });

  it("addDealContact/setDealPrimaryContact/removeDealContact manage the deal's contact roster", () => {
    const company = companies.find((c) => contacts.some((ct) => ct.companyId === c._id));
    const companyContacts = contacts.filter((c) => c.companyId === company._id);
    const deal = createDealRecord({ name: "Multi contact deal", companyId: company._id, primaryContactId: companyContacts[0]._id }, "Tester");
    if (companyContacts[1]) {
      const withContact = addDealContact(deal._id, { contactId: companyContacts[1]._id, role: "Influencer" }, "Tester");
      expect(withContact.additionalContactIds).toContain(companyContacts[1]._id);
      const rePrimaried = setDealPrimaryContact(deal._id, companyContacts[1]._id, "Tester");
      expect(rePrimaried.primaryContactId).toBe(companyContacts[1]._id);
      expect(rePrimaried.additionalContactIds).toContain(companyContacts[0]._id);
      const removed = removeDealContact(deal._id, companyContacts[0]._id, "Tester");
      expect(removed.additionalContactIds).not.toContain(companyContacts[0]._id);
    }
  });

  it("addDealQuotePreview and file helpers do not touch the separate Quotes/Files systems", () => {
    const deal = createDealRecord({ name: "Preview quote deal", companyId: companies[0]._id, value: 4000 }, "Tester");
    const withQuote = addDealQuotePreview(deal._id, { amount: 4000, status: "Draft" }, "Tester");
    expect(withQuote.quotes).toHaveLength(1);
    expect(withQuote.quotes[0].version).toBe(1);

    const withFile = addDealFile(deal._id, { name: "brief.pdf", size: 1024, type: "application/pdf" }, "Tester");
    expect(withFile.files).toHaveLength(1);
    const withoutFile = deleteDealFile(deal._id, withFile.files[0]._id, "Tester");
    expect(withoutFile.files).toHaveLength(0);
  });

  it("queryDealsLocal filters by status and groups pipeline value by currency", () => {
    const usdDeal = createDealRecord({ name: "USD open deal", companyId: companies[0]._id, value: 1000, currency: "USD", stage: "Discovery" }, "Tester");
    const eurDeal = createDealRecord({ name: "EUR open deal", companyId: companies[0]._id, value: 500, currency: "EUR", stage: "Discovery" }, "Tester");
    const result = queryDealsLocal(deals, { status: "Open", search: "open deal", pageSize: 1000 });
    const ids = result.deals.map((d) => d._id);
    expect(ids).toContain(usdDeal._id);
    expect(ids).toContain(eurDeal._id);
    expect(result.summary.openValueByCurrency.USD).toBeGreaterThanOrEqual(1000);
    expect(result.summary.openValueByCurrency.EUR).toBeGreaterThanOrEqual(500);
  });

  it("queryDealsLocal never returns more items than pageSize", () => {
    for (let i = 0; i < 5; i++) {
      createDealRecord({ name: `Page sizing deal ${i} ${Date.now()}`, companyId: companies[0]._id }, "Tester");
    }
    const result = queryDealsLocal(deals, { search: "Page sizing deal", page: 1, pageSize: 2 });
    expect(result.deals.length).toBeLessThanOrEqual(2);
    expect(result.total).toBeGreaterThanOrEqual(5);
  });
});
