import { describe, it, expect } from "vitest";
import {
  CONTRACT_TYPES, CONTRACT_STATUSES, SETTABLE_STATUSES, RENEWAL_TYPES, PAYMENT_TERMS_OPTIONS,
  makeContractLine, computeLineSubtotal, computeLineDiscountAmount, computeLineTotal, computeContractTotals,
  getEffectiveStatus, isRenewalDue, hasIncompleteSignatory, deriveContractType,
  buildContractFromQuotePreview, buildContractFromOrderPreview, buildContractFromDealPreview,
  validateContractPayload, createContract, findContractRecord, contractsForQuote, contractsForOrder, contractsForDeal, contractsForCompany,
  updateContract, archiveContract, restoreContract, bulkAssignOwner, bulkArchive, buildContractDuplicatePreview,
  submitForInternalReview, sendForSignature, recordSignature, renewContract, terminateContract, cancelContract, expireContract,
  queryContractsLocal, contracts,
  DRAFT_MANUAL_CONTRACT, SIGNED_ONE_TIME_CONTRACT, SIGNED_SUBSCRIPTION_AUTO_RENEW_CONTRACT, SIGNED_RENEWAL_DUE_CONTRACT,
  EXPIRED_CONTRACT, TERMINATED_CONTRACT, CANCELLED_CONTRACT, ARCHIVED_CONTRACT, INCOMPLETE_SIGNATORY_CONTRACT,
} from "./mockContractData";
import { PREVIEW_ACCEPTED_QUOTE } from "./mockQuoteData";
import { CONFIRMED_PRODUCT_ORDER } from "./mockOrderData";
import { ACTIVE_ONE_TIME_PRODUCT } from "./mockCatalogData";
import { deals } from "./mockCrmData";

describe("mockContractData: enums", () => {
  it("defines the 4 contract types", () => {
    expect(CONTRACT_TYPES).toEqual(["One-Time Agreement", "Subscription / Recurring Service Agreement", "Master Service Agreement", "Amendment"]);
  });
  it("defines the contract status lifecycle, keeping Signed as the operative status", () => {
    expect(CONTRACT_STATUSES).toContain("Signed");
    expect(CONTRACT_STATUSES).toContain("Archived");
    expect(SETTABLE_STATUSES).not.toContain("Archived");
  });
  it("does not use Paid or Approved as a Contract status", () => {
    expect(CONTRACT_STATUSES).not.toContain("Paid");
    expect(CONTRACT_STATUSES).not.toContain("Approved");
  });
  it("defines the 3 renewal types", () => {
    expect(RENEWAL_TYPES).toEqual(["Auto-Renew", "Manual Renew", "No Renewal"]);
  });
  it("defines payment terms options", () => {
    expect(PAYMENT_TERMS_OPTIONS.length).toBeGreaterThan(0);
  });
});

describe("mockContractData: fixtures", () => {
  it("includes all 16 curated fixture scenarios plus randomized fixtures", () => {
    expect(contracts.length).toBeGreaterThanOrEqual(22);
  });
  it("each curated fixture has a unique id and contract number", () => {
    const ids = new Set(contracts.map((c) => c._id));
    const numbers = new Set(contracts.map((c) => c.contractNumber));
    expect(ids.size).toBe(contracts.length);
    expect(numbers.size).toBe(contracts.length);
  });
  it("SIGNED_RENEWAL_DUE_CONTRACT is flagged as renewal due", () => {
    expect(isRenewalDue(SIGNED_RENEWAL_DUE_CONTRACT)).toBe(true);
  });
  it("SIGNED_SUBSCRIPTION_AUTO_RENEW_CONTRACT is not yet renewal due", () => {
    expect(isRenewalDue(SIGNED_SUBSCRIPTION_AUTO_RENEW_CONTRACT)).toBe(false);
  });
  it("EXPIRED_CONTRACT has an Expired status", () => {
    expect(getEffectiveStatus(EXPIRED_CONTRACT)).toBe("Expired");
  });
  it("TERMINATED_CONTRACT has a termination reason", () => {
    expect(TERMINATED_CONTRACT.status).toBe("Terminated");
    expect(TERMINATED_CONTRACT.terminationReason).toBeTruthy();
  });
  it("CANCELLED_CONTRACT has a cancellation reason", () => {
    expect(CANCELLED_CONTRACT.status).toBe("Cancelled");
    expect(CANCELLED_CONTRACT.cancellationReason).toBeTruthy();
  });
  it("ARCHIVED_CONTRACT reports Archived as its effective status but preserves statusBeforeArchive", () => {
    expect(getEffectiveStatus(ARCHIVED_CONTRACT)).toBe("Archived");
    expect(ARCHIVED_CONTRACT.statusBeforeArchive).toBe("Expired");
  });
  it("INCOMPLETE_SIGNATORY_CONTRACT is flagged as having an incomplete signatory", () => {
    expect(hasIncompleteSignatory(INCOMPLETE_SIGNATORY_CONTRACT)).toBe(true);
  });
  it("SIGNED_ONE_TIME_CONTRACT has no incomplete signatory", () => {
    expect(hasIncompleteSignatory(SIGNED_ONE_TIME_CONTRACT)).toBe(false);
  });
});

describe("mockContractData: line math and frozen snapshot", () => {
  it("computes line subtotal, discount, and total", () => {
    const line = makeContractLine({ quantity: 3, unitPrice: 100, discountType: "Percentage", discountValue: 10 });
    expect(computeLineSubtotal(line)).toBe(300);
    expect(computeLineDiscountAmount(line)).toBe(30);
    expect(computeLineTotal(line)).toBe(270);
  });

  it("snapshots pricing at creation time — a later catalog price change never affects an existing line", () => {
    const originalPrice = ACTIVE_ONE_TIME_PRODUCT.standardPrice;
    const line = makeContractLine({ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, quantity: 1 });
    const snapshotPrice = line.unitPrice;
    ACTIVE_ONE_TIME_PRODUCT.standardPrice = originalPrice + 500;
    expect(line.unitPrice).toBe(snapshotPrice);
    ACTIVE_ONE_TIME_PRODUCT.standardPrice = originalPrice;
  });

  it("computes contract totals split by one-time vs recurring", () => {
    const contract = { lineItems: [makeContractLine({ billingModel: "One Time", quantity: 1, unitPrice: 1000 }), makeContractLine({ billingModel: "Recurring", billingInterval: "Monthly", quantity: 1, unitPrice: 200 })] };
    const totals = computeContractTotals(contract);
    expect(totals.oneTimeTotal).toBe(1000);
    expect(totals.recurringTotal).toBe(200);
    expect(totals.grandTotal).toBeGreaterThan(1200);
  });

  it("derives contract type from line billing model", () => {
    expect(deriveContractType([makeContractLine({ billingModel: "One Time" })])).toBe("One-Time Agreement");
    expect(deriveContractType([makeContractLine({ billingModel: "Recurring", billingInterval: "Monthly" })])).toBe("Subscription / Recurring Service Agreement");
  });
});

describe("mockContractData: builders from Quote/Order/Deal (pure, non-mutating)", () => {
  it("buildContractFromQuotePreview copies commercial data and freezes a line snapshot without mutating the Quote", () => {
    const before = JSON.stringify(PREVIEW_ACCEPTED_QUOTE);
    const preview = buildContractFromQuotePreview(PREVIEW_ACCEPTED_QUOTE._id);
    expect(preview.companyId).toBe(PREVIEW_ACCEPTED_QUOTE.companyId);
    expect(preview.sourceQuoteId).toBe(PREVIEW_ACCEPTED_QUOTE._id);
    expect(preview.sourceQuoteVersion).toBe(PREVIEW_ACCEPTED_QUOTE.version);
    expect(JSON.stringify(PREVIEW_ACCEPTED_QUOTE)).toBe(before);
  });

  it("buildContractFromOrderPreview copies commercial data and freezes a line snapshot without mutating the Order", () => {
    const before = JSON.stringify(CONFIRMED_PRODUCT_ORDER);
    const preview = buildContractFromOrderPreview(CONFIRMED_PRODUCT_ORDER._id);
    expect(preview.companyId).toBe(CONFIRMED_PRODUCT_ORDER.companyId);
    expect(preview.sourceOrderId).toBe(CONFIRMED_PRODUCT_ORDER._id);
    expect(preview.lineItems.length).toBe(CONFIRMED_PRODUCT_ORDER.lineItems.length);
    expect(JSON.stringify(CONFIRMED_PRODUCT_ORDER)).toBe(before);
  });

  it("buildContractFromDealPreview returns a draft skeleton linked to the Deal", () => {
    const deal = deals[0];
    const preview = buildContractFromDealPreview(deal._id);
    expect(preview.dealId).toBe(deal._id);
    expect(preview.companyId).toBe(deal.companyId);
    expect(preview.lineItems).toEqual([]);
  });

  it("returns null for an unknown source id", () => {
    expect(buildContractFromQuotePreview("not-a-real-id")).toBeNull();
    expect(buildContractFromOrderPreview("not-a-real-id")).toBeNull();
    expect(buildContractFromDealPreview("not-a-real-id")).toBeNull();
  });
});

describe("mockContractData: validation", () => {
  it("requires company, currency, and at least one line item", () => {
    const { errors } = validateContractPayload({ lineItems: [] });
    expect(errors.companyId).toBeTruthy();
    expect(errors.currency).toBeTruthy();
    expect(errors.lineItems).toBeTruthy();
  });

  it("requires effective date, end date, and end after effective", () => {
    const { errors } = validateContractPayload({
      companyId: "x", currency: "USD", lineItems: [makeContractLine({ quantity: 1, unitPrice: 10 })],
      effectiveDate: "2026-01-01", endDate: "2025-01-01", renewalType: "No Renewal", paymentTerms: "Net 30",
    });
    expect(errors.endDate).toBeTruthy();
  });

  it("passes validation for a well-formed payload", () => {
    const { errors } = validateContractPayload({
      companyId: "x", currency: "USD", lineItems: [makeContractLine({ quantity: 1, unitPrice: 10 })],
      effectiveDate: "2026-01-01", endDate: "2027-01-01", renewalType: "No Renewal", paymentTerms: "Net 30", billingContactId: "c1",
    });
    expect(Object.keys(errors).length).toBe(0);
  });
});

describe("mockContractData: CRUD", () => {
  let created;
  it("creates a contract", () => {
    created = createContract({
      companyId: "co1", currency: "USD", lineItems: [makeContractLine({ quantity: 1, unitPrice: 500 })],
      effectiveDate: "2026-01-01", endDate: "2027-01-01", renewalType: "No Renewal", paymentTerms: "Net 30",
    }, "Test User");
    expect(created._id).toBeTruthy();
    expect(findContractRecord(created._id)).toBe(created);
  });

  it("updates a contract and logs an audit entry for a tracked field", () => {
    const updated = updateContract(created._id, { status: "Pending Internal Review" }, "Test User");
    expect(updated.status).toBe("Pending Internal Review");
    expect(updated.auditLog.some((a) => a.field === "status")).toBe(true);
  });

  it("archives and restores a contract, preserving statusBeforeArchive", () => {
    const archived = archiveContract(created._id, "test archive reason", "Test User");
    expect(archived.archived).toBe(true);
    expect(archived.statusBeforeArchive).toBe("Pending Internal Review");
    const restored = restoreContract(created._id, "Test User");
    expect(restored.archived).toBe(false);
    expect(restored.status).toBe("Pending Internal Review");
  });

  it("bulk-assigns owner and bulk-archives", () => {
    const c2 = createContract({ companyId: "co2", currency: "USD", lineItems: [makeContractLine({ quantity: 1, unitPrice: 100 })], effectiveDate: "2026-01-01", endDate: "2027-01-01", renewalType: "No Renewal", paymentTerms: "Net 30" });
    const [assigned] = bulkAssignOwner([c2._id], "u2", "Test User");
    expect(assigned.ownerId).toBe("u2");
    const [archived] = bulkArchive([c2._id], "bulk archive reason", "Test User");
    expect(archived.archived).toBe(true);
  });

  it("builds a duplicate preview that resets signatures and status", () => {
    const preview = buildContractDuplicatePreview(SIGNED_ONE_TIME_CONTRACT._id);
    expect(preview.status).toBe("Draft");
    expect(preview.signatories.internal.signedAt).toBeNull();
    expect(preview.signatories.customer.signedAt).toBeNull();
  });

  it("finds contracts related to a Quote/Order/Deal/Company", () => {
    expect(Array.isArray(contractsForQuote("x"))).toBe(true);
    expect(Array.isArray(contractsForOrder("x"))).toBe(true);
    expect(Array.isArray(contractsForDeal("x"))).toBe(true);
    expect(Array.isArray(contractsForCompany("x"))).toBe(true);
  });
});

describe("mockContractData: status transitions", () => {
  let c;
  it("submits for internal review", () => {
    c = createContract({ companyId: "co3", currency: "USD", lineItems: [makeContractLine({ quantity: 1, unitPrice: 100 })], effectiveDate: "2026-01-01", endDate: "2027-01-01", renewalType: "No Renewal", paymentTerms: "Net 30" });
    submitForInternalReview(c._id, "Tester");
    expect(findContractRecord(c._id).status).toBe("Pending Internal Review");
  });

  it("sends for signature", () => {
    sendForSignature(c._id, {}, "Tester");
    expect(findContractRecord(c._id).status).toBe("Sent for Signature");
  });

  it("recordSignature rejects a missing party or name", () => {
    expect(recordSignature(c._id, { party: null, name: "X" })).toBeNull();
    expect(recordSignature(c._id, { party: "internal", name: "" })).toBeNull();
  });

  it("records one signatory without promoting status yet", () => {
    recordSignature(c._id, { party: "internal", name: "Alice Internal", title: "Manager" }, "Tester");
    expect(findContractRecord(c._id).status).toBe("Sent for Signature");
  });

  it("auto-promotes to Signed once both signatories are recorded", () => {
    recordSignature(c._id, { party: "customer", name: "Bob Customer", title: "Owner" }, "Tester");
    const after = findContractRecord(c._id);
    expect(after.status).toBe("Signed");
    expect(after.signedAt).toBeTruthy();
  });

  it("renews a Signed contract and logs an amendment entry", () => {
    const renewed = renewContract(c._id, { newEndDate: "2028-01-01", note: "Renewed for another year" }, "Tester");
    expect(renewed.endDate).toBe("2028-01-01");
    expect(renewed.amendmentHistory.length).toBe(1);
  });

  it("renewContract rejects a contract that isn't Signed", () => {
    const draft = createContract({ companyId: "co4", currency: "USD", lineItems: [makeContractLine({ quantity: 1, unitPrice: 100 })], effectiveDate: "2026-01-01", endDate: "2027-01-01", renewalType: "No Renewal", paymentTerms: "Net 30" });
    expect(renewContract(draft._id, { newEndDate: "2030-01-01" })).toBeNull();
  });

  it("terminates a contract, requiring a reason", () => {
    expect(terminateContract(c._id, { reason: "" })).toBeNull();
    const terminated = terminateContract(c._id, { reason: "Customer request" }, "Tester");
    expect(terminated.status).toBe("Terminated");
  });

  it("cancels a pre-signature contract, requiring a reason, and rejects cancelling a Signed contract", () => {
    const draft = createContract({ companyId: "co5", currency: "USD", lineItems: [makeContractLine({ quantity: 1, unitPrice: 100 })], effectiveDate: "2026-01-01", endDate: "2027-01-01", renewalType: "No Renewal", paymentTerms: "Net 30" });
    expect(cancelContract(draft._id, { reason: "" })).toBeNull();
    const cancelled = cancelContract(draft._id, { reason: "No longer needed" }, "Tester");
    expect(cancelled.status).toBe("Cancelled");
    expect(cancelContract(SIGNED_ONE_TIME_CONTRACT._id, { reason: "test" })).toBeNull();
  });

  it("marks a contract expired", () => {
    const expired = expireContract(c._id, "Tester");
    expect(expired.status).toBe("Expired");
  });
});

describe("mockContractData: queryContractsLocal", () => {
  it("filters by status and excludes archived by default", () => {
    const { contracts: results } = queryContractsLocal(contracts, { status: "Signed" });
    expect(results.every((c) => getEffectiveStatus(c) === "Signed")).toBe(true);
  });

  it("filters by renewalDue and incompleteSignatory flags", () => {
    const { contracts: renewalResults } = queryContractsLocal(contracts, { renewalDue: "true" });
    expect(renewalResults.every((c) => isRenewalDue(c))).toBe(true);
    const { contracts: incompleteResults } = queryContractsLocal(contracts, { incompleteSignatory: "true" });
    expect(incompleteResults.every((c) => hasIncompleteSignatory(c))).toBe(true);
  });

  it("searches by contract number", () => {
    const { contracts: results } = queryContractsLocal(contracts, { search: DRAFT_MANUAL_CONTRACT.contractNumber });
    expect(results.some((c) => c._id === DRAFT_MANUAL_CONTRACT._id)).toBe(true);
  });

  it("paginates results", () => {
    const { contracts: page1, total } = queryContractsLocal(contracts, { page: 1, pageSize: 2 });
    expect(page1.length).toBeLessThanOrEqual(2);
    expect(total).toBe(contracts.filter((c) => !c.archived).length);
  });
});
