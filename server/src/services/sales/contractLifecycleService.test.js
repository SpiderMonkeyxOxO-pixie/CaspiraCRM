import { describe, it, expect } from "vitest";
import { isRenewalDue, isExpiringSoon, isExpired, hasIncompleteSignatory, isObligationOverdue } from "./contractLifecycleService.js";

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

describe("isRenewalDue", () => {
  it("is true only for a Signed, renewable Contract within its notice window", () => {
    expect(isRenewalDue({ status: "Signed", renewalType: "Auto-Renew", endDate: daysFromNow(10), renewalNoticeDays: 60 })).toBe(true);
  });
  it("is false for a Contract with No Renewal", () => {
    expect(isRenewalDue({ status: "Signed", renewalType: "No Renewal", endDate: daysFromNow(10), renewalNoticeDays: 60 })).toBe(false);
  });
  it("is false when not yet within the notice window", () => {
    expect(isRenewalDue({ status: "Signed", renewalType: "Manual Renew", endDate: daysFromNow(200), renewalNoticeDays: 60 })).toBe(false);
  });
  it("is false for a Draft Contract", () => {
    expect(isRenewalDue({ status: "Draft", renewalType: "Auto-Renew", endDate: daysFromNow(10), renewalNoticeDays: 60 })).toBe(false);
  });
});

describe("isExpiringSoon", () => {
  it("is true within the fixed 30-day window", () => {
    expect(isExpiringSoon({ status: "Signed", endDate: daysFromNow(15) })).toBe(true);
  });
  it("is false beyond 30 days", () => {
    expect(isExpiringSoon({ status: "Signed", endDate: daysFromNow(45) })).toBe(false);
  });
});

describe("isExpired", () => {
  it("is true for a Signed contract whose end date already passed", () => {
    expect(isExpired({ status: "Signed", endDate: daysFromNow(-5) })).toBe(true);
  });
  it("is false for a future end date", () => {
    expect(isExpired({ status: "Signed", endDate: daysFromNow(5) })).toBe(false);
  });
});

describe("hasIncompleteSignatory", () => {
  it("is true when sent for signature but only one party has signed", () => {
    expect(hasIncompleteSignatory({ status: "Sent for Signature", internalSignedAt: new Date(), customerSignedAt: null })).toBe(true);
  });
  it("is false once fully Signed with both signatures", () => {
    expect(hasIncompleteSignatory({ status: "Signed", internalSignedAt: new Date(), customerSignedAt: new Date() })).toBe(false);
  });
});

describe("isObligationOverdue", () => {
  it("is true for an open obligation past its due date", () => {
    expect(isObligationOverdue({ status: "Open", dueDate: daysFromNow(-1) })).toBe(true);
  });
  it("is false once completed, regardless of due date", () => {
    expect(isObligationOverdue({ status: "Completed", dueDate: daysFromNow(-1) })).toBe(false);
  });
});
