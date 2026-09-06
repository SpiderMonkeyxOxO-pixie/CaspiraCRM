import { describe, it, expect } from "vitest";
import { requiresApproval, canDecide } from "./quoteApprovalService.js";

describe("requiresApproval", () => {
  it("flags a line discount above the warning threshold", () => {
    const result = requiresApproval({}, [{ name: "Widget", discountType: "Percentage", discountValue: 25 }]);
    expect(result.required).toBe(true);
    expect(result.reasons[0]).toMatch(/discount above 20%/);
  });

  it("flags a manually overridden price", () => {
    const result = requiresApproval({}, [{ name: "Widget", isOverridden: true }]);
    expect(result.required).toBe(true);
  });

  it("flags a high quote total", () => {
    const result = requiresApproval({ grandTotal: 75000 }, []);
    expect(result.required).toBe(true);
  });

  it("does not require approval for an ordinary quote", () => {
    const result = requiresApproval({ grandTotal: 500 }, [{ name: "Widget", discountType: "Percentage", discountValue: 5 }]);
    expect(result.required).toBe(false);
  });
});

describe("canDecide", () => {
  it("rejects the requester deciding their own approval", () => {
    expect(canDecide({ requestedByMembershipId: "m1" }, "m1")).toBe(false);
  });

  it("allows a different membership to decide", () => {
    expect(canDecide({ requestedByMembershipId: "m1" }, "m2")).toBe(true);
  });
});
