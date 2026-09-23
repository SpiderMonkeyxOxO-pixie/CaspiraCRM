import { describe, it, expect, vi, beforeEach } from "vitest";
import * as sla from "./slaService.js";

// A small in-memory transaction client — enough for the clock rules.
function fakeTx({ version = null, entitlements = [], contracts = {}, queue = null, policy = null } = {}) {
  const clocks = [];
  const events = [];
  let seq = 0;
  const match = (c, where) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && "in" in v) return v.in.includes(c[k]);
    return c[k] === v;
  });
  return {
    clocks, events,
    supportEntitlement: { findMany: vi.fn(async () => entitlements), findFirst: vi.fn(async ({ where }) => entitlements.find((e) => e.id === where.id) || null) },
    contract: { findFirst: vi.fn(async ({ where }) => contracts[where.id] || null) },
    supportQueue: { findUnique: vi.fn(async () => queue) },
    slaPolicy: { findFirst: vi.fn(async () => policy) },
    slaPolicyVersion: { findUnique: vi.fn(async () => version) },
    slaClock: {
      create: vi.fn(async ({ data }) => { const c = { id: `c${++seq}`, pausedMinutes: 0, completedAt: null, breachedAt: null, warnedAt: null, pausedAt: null, createdAt: new Date(Date.now() + seq), ...data }; clocks.push(c); return c; }),
      findMany: vi.fn(async ({ where }) => clocks.filter((c) => match(c, where))),
      findFirst: vi.fn(async ({ where }) => clocks.filter((c) => match(c, where)).sort((a, b) => b.createdAt - a.createdAt)[0] || null),
      update: vi.fn(async ({ where, data }) => Object.assign(clocks.find((c) => c.id === where.id), data)),
    },
    ticket: { update: vi.fn() },
    ticketEvent: { create: vi.fn(async ({ data }) => { events.push(data); return data; }) },
  };
}

const T0 = new Date("2026-09-28T00:00:00Z");
const ticket = (over = {}) => ({ id: "t1", organizationId: "org1", priority: "High", status: "New", createdAt: T0, companyId: null, queueId: null, ...over });

beforeEach(() => vi.useRealTimers());

describe("SLA clocks", () => {
  it("without a policy, starts built-in first-response and resolution clocks (24/7)", async () => {
    const tx = fakeTx();
    await sla.startClocks(tx, ticket());
    const [fr, res] = tx.clocks;
    expect(fr).toMatchObject({ targetType: "First Response", targetMinutes: 240, businessHours: false });
    expect(fr.dueAt.toISOString()).toBe("2026-09-28T04:00:00.000Z");
    expect(res.dueAt.toISOString()).toBe("2026-09-29T00:00:00.000Z");
    expect(fr.warnAt.toISOString()).toBe("2026-09-28T03:12:00.000Z"); // 80% of 4h
    expect(tx.events[0]).toMatchObject({ eventType: "SLA Applied", snapshot: expect.objectContaining({ source: "Built-in windows" }) });
  });

  it("uses the company's valid entitlement policy; an expired contract grants nothing", async () => {
    const version = { id: "v1", versionNumber: 2, targets: { High: { firstResponseMinutes: 30, resolutionMinutes: 120 } }, warningPercent: 50, businessHours: false };
    const expiredContract = { status: "Signed", endDate: new Date("2026-01-01") };
    const tx = fakeTx({ version, entitlements: [{ id: "e1", contractId: "k1", slaPolicyVersionId: "v1" }], contracts: { k1: expiredContract } });
    await sla.startClocks(tx, ticket({ companyId: "co1" }));
    expect(tx.clocks[0].targetMinutes).toBe(240); // fell back to built-in

    const tx2 = fakeTx({ version, entitlements: [{ id: "e1", contractId: "k1", slaPolicyVersionId: "v1" }], contracts: { k1: { status: "Signed", endDate: new Date("2030-01-01") } } });
    await sla.startClocks(tx2, ticket({ companyId: "co1" }));
    expect(tx2.clocks[0]).toMatchObject({ targetMinutes: 30, policyVersionId: "v1" });
  });

  it("first response is met only by a public agent reply", async () => {
    const tx = fakeTx();
    await sla.startClocks(tx, ticket());
    await sla.onPublicAgentReply(tx, ticket(), new Date("2026-09-28T01:00:00Z"));
    expect(tx.clocks[0]).toMatchObject({ state: "Met" });
    expect(tx.clocks[1].state).toBe("Running"); // resolution unaffected
  });

  it("a late reply records the breach at the due time, not the reply time", async () => {
    const tx = fakeTx();
    await sla.startClocks(tx, ticket());
    await sla.onPublicAgentReply(tx, ticket(), new Date("2026-09-28T06:00:00Z"));
    expect(tx.clocks[0].state).toBe("Breached");
    expect(tx.clocks[0].breachedAt.toISOString()).toBe("2026-09-28T04:00:00.000Z");
  });

  it("waiting for the customer pauses resolution; resuming pushes the deadline by the paused time", async () => {
    vi.useFakeTimers();
    const tx = fakeTx();
    await sla.startClocks(tx, ticket());
    vi.setSystemTime(new Date("2026-09-28T02:00:00Z"));
    await sla.onStatusChange(tx, ticket({ status: "Waiting for Customer" }), "Open");
    expect(tx.clocks[1].state).toBe("Paused");
    vi.setSystemTime(new Date("2026-09-28T05:00:00Z"));
    await sla.onStatusChange(tx, ticket({ status: "Open" }), "Waiting for Customer");
    expect(tx.clocks[1]).toMatchObject({ state: "Running", pausedMinutes: 180 });
    expect(tx.clocks[1].dueAt.toISOString()).toBe("2026-09-29T03:00:00.000Z");
    // "Waiting for Internal Team" does not pause.
    await sla.onStatusChange(tx, ticket({ status: "Waiting for Internal Team" }), "Open");
    expect(tx.clocks[1].state).toBe("Running");
  });

  it("a priority change reschedules unbreached clocks only", async () => {
    const tx = fakeTx();
    await sla.startClocks(tx, ticket());
    tx.clocks[0].breachedAt = new Date("2026-09-28T04:00:00Z");
    tx.clocks[0].state = "Breached";
    await sla.onPriorityChange(tx, ticket({ priority: "Urgent" }), "High");
    expect(tx.clocks[0].targetMinutes).toBe(240); // breached history untouched
    expect(tx.clocks[1]).toMatchObject({ targetMinutes: 240 }); // Urgent resolution = 4h
    expect(tx.events.at(-1)).toMatchObject({ eventType: "SLA Recalculated", fromValue: "High", toValue: "Urgent" });
  });

  it("resolving without a reply cancels first response instead of calling it met", async () => {
    const tx = fakeTx();
    await sla.startClocks(tx, ticket());
    await sla.onResolved(tx, ticket(), new Date("2026-09-28T01:00:00Z"));
    expect(tx.clocks[0].state).toBe("Cancelled");
    expect(tx.clocks[1].state).toBe("Met");
  });
});
