import { describe, it, expect, vi } from "vitest";

const findMany = { ticket: vi.fn(), slaClock: vi.fn(), ticketSatisfaction: vi.fn(), kbArticle: vi.fn() };
vi.mock("../../lib/prisma.js", () => ({
  default: Object.fromEntries(Object.entries(findMany).map(([k, fn]) => [k, { findMany: fn }])),
}));
const { supportSummary, rate, ageBucket, MIN_SAMPLE } = await import("./supportReportsService.js");

describe("support reports", () => {
  it("rates show numerator and denominator, and refuse tiny samples", () => {
    expect(rate(3, 4)).toMatchObject({ numerator: 3, denominator: 4, rate: null });
    expect(rate(9, 10)).toEqual({ numerator: 9, denominator: 10, rate: 90 });
  });

  it("buckets backlog age", () => {
    const now = new Date("2026-09-30T00:00:00Z");
    expect(ageBucket("2026-09-29T12:00:00Z", now)).toBe("Under 1 day");
    expect(ageBucket("2026-09-25T00:00:00Z", now)).toBe("3–7 days");
    expect(ageBucket("2026-07-01T00:00:00Z", now)).toBe("Over 30 days");
  });

  it("applies the caller's scope before counting anything", async () => {
    for (const fn of Object.values(findMany)) fn.mockResolvedValue([]);
    const scope = { OR: [{ assignedMembershipId: "m1" }] };
    const out = await supportSummary({ organizationId: "org1", scopeWhere: scope, from: new Date("2026-09-01"), to: new Date("2026-09-30") });
    expect(findMany.ticket.mock.calls[0][0].where).toMatchObject({ organizationId: "org1", archivedAt: null, ...scope });
    expect(findMany.slaClock.mock.calls[0][0].where.ticket).toMatchObject(scope);
    expect(out.firstResponseSla.rate).toBeNull();
    expect(out.satisfaction.note).toMatch(String(MIN_SAMPLE));
  });
});
