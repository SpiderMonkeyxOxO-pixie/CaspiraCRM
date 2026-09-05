import { describe, it, expect, beforeEach } from "vitest";
import { checkCooldown, _resetCooldowns, truncateRecords, MAX_RECORDS_PER_TYPE, verifyNoNewNumbers } from "./guardrails.js";

describe("guardrails", () => {
  beforeEach(() => _resetCooldowns());

  describe("checkCooldown", () => {
    it("allows the first request for a user", () => {
      expect(() => checkCooldown("user-1")).not.toThrow();
    });

    it("blocks a second immediate request from the same user with a 429", () => {
      checkCooldown("user-1");
      try {
        checkCooldown("user-1");
        throw new Error("should have thrown");
      } catch (e) {
        expect(e.status).toBe(429);
        expect(e.message).toMatch(/wait/i);
      }
    });

    it("does not block a different user", () => {
      checkCooldown("user-1");
      expect(() => checkCooldown("user-2")).not.toThrow();
    });
  });

  describe("truncateRecords", () => {
    it("leaves small arrays untouched and reports truncated: false", () => {
      const { records, truncated } = truncateRecords({ deals: [{ _id: "1" }, { _id: "2" }] });
      expect(records.deals).toHaveLength(2);
      expect(truncated).toBe(false);
    });

    it("caps an oversized array at MAX_RECORDS_PER_TYPE and reports truncated: true", () => {
      const deals = Array.from({ length: MAX_RECORDS_PER_TYPE + 10 }, (_, i) => ({ _id: String(i) }));
      const { records, truncated } = truncateRecords({ deals });
      expect(records.deals).toHaveLength(MAX_RECORDS_PER_TYPE);
      expect(truncated).toBe(true);
    });

    it("truncates each record type independently", () => {
      const deals = Array.from({ length: MAX_RECORDS_PER_TYPE + 1 }, (_, i) => ({ _id: String(i) }));
      const companies = [{ _id: "c1" }];
      const { records, truncated } = truncateRecords({ deals, companies });
      expect(records.deals).toHaveLength(MAX_RECORDS_PER_TYPE);
      expect(records.companies).toHaveLength(1);
      expect(truncated).toBe(true);
    });
  });

  describe("verifyNoNewNumbers", () => {
    const facts = { openPipelineValue: "$482,300", openPipelineCount: 14, weightedPipelineValue: "$210,900" };

    it("verifies a narrative that only repeats numbers present in facts", () => {
      const narrative = "Your pipeline holds steady at $482,300 across 14 open deals, weighted at $210,900.";
      const result = verifyNoNewNumbers(narrative, facts);
      expect(result.verified).toBe(true);
      expect(result.unverifiedNumbers).toEqual([]);
    });

    it("catches a fabricated number not present anywhere in facts", () => {
      const narrative = "Your pipeline holds steady at $999,999 across 14 open deals.";
      const result = verifyNoNewNumbers(narrative, facts);
      expect(result.verified).toBe(false);
      expect(result.unverifiedNumbers).toContain("999999");
    });

    it("verifies a narrative with no numbers at all", () => {
      const result = verifyNoNewNumbers("Your pipeline looks healthy overall.", facts);
      expect(result.verified).toBe(true);
    });

    it("catches a subtly altered number (off by one digit)", () => {
      const narrative = "You have 15 open deals."; // facts say 14
      const result = verifyNoNewNumbers(narrative, facts);
      expect(result.verified).toBe(false);
    });
  });
});
