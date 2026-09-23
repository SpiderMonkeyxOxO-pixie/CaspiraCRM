import { describe, it, expect, vi, beforeEach } from "vitest";

const clocks = [];
const events = new Map();
const outbox = [];
vi.mock("../../lib/prisma.js", () => ({
  default: {
    slaClock: {
      findMany: vi.fn(async ({ where }) => clocks.filter((c) => c.state === where.state && !c.completedAt && (where.breachedAt === null ? !c.breachedAt : true) && (where.dueAt?.lte ? c.dueAt <= where.dueAt.lte : true) && (where.warnedAt === null ? !c.warnedAt : true) && (where.warnAt?.lte ? c.warnAt <= where.warnAt.lte : true) && (where.dueAt?.gt ? c.dueAt > where.dueAt.gt : true))),
      updateMany: vi.fn(async ({ where, data }) => {
        const c = clocks.find((x) => x.id === where.id && x.state === where.state && (where.breachedAt === null ? !x.breachedAt : true) && (where.warnedAt === null ? !x.warnedAt : true));
        if (!c) return { count: 0 };
        Object.assign(c, data);
        return { count: 1 };
      }),
    },
    ticketEvent: {
      create: vi.fn(async ({ data }) => {
        if (events.has(data.dedupeKey)) throw Object.assign(new Error("dup"), { code: "P2002" });
        events.set(data.dedupeKey, data);
        return data;
      }),
    },
    outboxEvent: { findFirst: vi.fn(async ({ where }) => outbox.find((o) => o.eventType === where.eventType && o.payload.clockId === where.payload.equals) || null), create: vi.fn(async ({ data }) => outbox.push(data)) },
    slaPolicyVersion: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../../services/auditService.js", () => ({ recordAuditEvent: vi.fn() }));

const { detectBreaches, detectWarnings } = await import("./slaJobs.js");

beforeEach(() => {
  clocks.length = 0;
  events.clear();
  outbox.length = 0;
});

describe("SLA sweep", () => {
  it("marks a breach at its due time, once, even after worker downtime", async () => {
    const dueAt = new Date("2026-09-28T04:00:00Z");
    clocks.push({ id: "c1", organizationId: "org1", ticketId: "t1", targetType: "First Response", state: "Running", dueAt, warnAt: dueAt, completedAt: null, breachedAt: null, warnedAt: null });
    const muchLater = new Date("2026-09-30T00:00:00Z"); // the worker was down for two days
    expect(await detectBreaches(muchLater)).toBe(1);
    expect(clocks[0]).toMatchObject({ state: "Breached", breachedAt: dueAt });
    expect(await detectBreaches(muchLater)).toBe(0); // re-run: nothing new
    expect(events.size).toBe(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].payload.internalOnly).toBe(true);
  });

  it("warns once before the due time and never after it", async () => {
    clocks.push({ id: "c2", organizationId: "org1", ticketId: "t1", targetType: "Resolution", state: "Running", warnAt: new Date("2026-09-28T03:00:00Z"), dueAt: new Date("2026-09-28T04:00:00Z"), completedAt: null, breachedAt: null, warnedAt: null });
    expect(await detectWarnings(new Date("2026-09-28T03:30:00Z"))).toBe(1);
    expect(await detectWarnings(new Date("2026-09-28T03:40:00Z"))).toBe(0);
    expect([...events.values()][0]).toMatchObject({ eventType: "SLA Warning" });
  });
});
