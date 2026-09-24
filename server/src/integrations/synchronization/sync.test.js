import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
  integrationTask: { updateMany: vi.fn(async () => ({ count: 1 })), findMany: vi.fn(async () => []), update: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  integrationConnection: { findFirst: vi.fn() },
  integrationRecordMapping: { findUnique: vi.fn(), update: vi.fn() },
  integrationConflict: { updateMany: vi.fn(async () => ({ count: 1 })), findUnique: vi.fn() },
  activity: { create: vi.fn(async ({ data }) => ({ id: "a1", ...data })) },
};
db.$transaction = vi.fn(async (fn) => fn(db));
vi.mock("../../lib/prisma.js", () => ({ default: db }));
process.env.INTEGRATIONS_MODE = "simulator";

const { classify } = await import("./syncService.js");
const { normalize, checksum, applyToCrm, crmFields } = await import("./transformers.js");
const queue = await import("../common/taskQueue.js");
const { KINDS, IntegrationError } = await import("../common/errors.js");
const conflicts = await import("../conflicts/conflictService.js");
const connections = await import("../connections/connectionService.js");

beforeEach(() => { for (const m of Object.values(db)) if (typeof m === "object") for (const fn of Object.values(m)) fn.mockClear?.(); });

const issue = (over = {}) => normalize("github", "Simulator", "issue", { id: "i1", title: "A", body: "x", state: "open", etag: "e1", ...over });

describe("sync classification", () => {
  it("new → create; unchanged → skip; echo of our export → skip", () => {
    const n = issue();
    expect(classify({ normalized: n, mapping: null, entityType: "issue" }).action).toBe("create");
    expect(classify({ normalized: n, mapping: { lastInboundChecksum: n.checksum }, entityType: "issue" }).action).toBe("skip");
    expect(classify({ normalized: n, mapping: { lastInboundChecksum: "old", lastOutboundChecksum: n.checksum }, entityType: "issue" }).reason).toMatch(/Echo/);
  });

  it("provider changed only → update; both changed → conflict", () => {
    const before = issue();
    const after = issue({ title: "B" });
    const crmSame = { title: "A", description: "x", statusCategory: "Backlog" };
    const mapping = { lastInboundChecksum: checksum(crmFields("issue", crmSame)) };
    expect(before.checksum).toBe(mapping.lastInboundChecksum);
    expect(classify({ normalized: after, mapping, crmRecord: crmSame, entityType: "issue" }).action).toBe("update");
    const crmEdited = { ...crmSame, title: "CRM edit" };
    expect(classify({ normalized: after, mapping, crmRecord: crmEdited, entityType: "issue" })).toMatchObject({ action: "conflict", crmValues: { title: "CRM edit" } });
  });

  it("a provider deletion never deletes: tombstone for mapped records; disconnected mappings are skipped", () => {
    expect(classify({ normalized: issue({ deleted: true }), mapping: { id: "m" }, entityType: "issue" }).action).toBe("tombstone");
    expect(classify({ normalized: issue({ deleted: true }), mapping: null, entityType: "issue" }).action).toBe("skip");
    expect(classify({ normalized: issue(), mapping: { syncState: "Disconnected" }, entityType: "issue" }).action).toBe("skip");
  });
});

describe("normalization", () => {
  it("calendar events keep their time zone; attendees are recorded, never invited", async () => {
    const n = normalize("google_workspace", "Live", "calendar_event", { id: "e", etag: "t", summary: "Demo", start: { dateTime: "2026-09-01T09:00:00+08:00", timeZone: "Asia/Manila" }, end: { dateTime: "2026-09-01T10:00:00+08:00", timeZone: "Asia/Manila" }, attendees: [{ email: "b@x" }, { email: "a@x" }] });
    expect(n.fields).toMatchObject({ timeZone: "Asia/Manila", startAt: "2026-09-01T01:00:00.000Z", attendees: ["a@x", "b@x"] });
    const created = await applyToCrm(db, { entityType: "calendar_event", connection: { organizationId: "o", connectedMembershipId: "m1" }, config: {}, run: {}, normalized: n, providerKey: "google_workspace" });
    expect(created.participants).toEqual([{ email: "a@x", external: true, invited: false }, { email: "b@x", external: true, invited: false }]);
    expect(created).toMatchObject({ timeZone: "Asia/Manila", type: "Meeting" });
    expect(normalize("google_workspace", "Live", "calendar_event", { id: "e", status: "cancelled" }).deleted).toBe(true);
  });

  it("GitHub pull requests aren't imported as tasks; Stripe amounts come from minor units", () => {
    expect(normalize("github", "Live", "issue", { id: 1, title: "PR", state: "open", pull_request: {} }).skip).toBe(true);
    expect(normalize("stripe", "Live", "financial_transaction", { id: "txn", amount: -1234, currency: "usd", created: 1_790_000_000 }).fields).toMatchObject({ amount: "12.34", direction: "Debit", currency: "USD" });
    expect(() => normalize("box", "Live", "issue", {})).toThrow(/can't be read/);
  });
});

describe("task queue", () => {
  it("backoff is exponential with jitter, capped; Retry-After wins", () => {
    expect(queue.backoffMs(1, null, () => 0.5)).toBe(60_000);
    expect(queue.backoffMs(3, null, () => 0)).toBe(120_000);
    expect(queue.backoffMs(20, null, () => 0.5)).toBe(3_600_000);
    expect(queue.backoffMs(1, 7000, () => 0)).toBe(7000);
  });

  it("permanent errors fail at once; retryable ones back off; exhausted ones dead-letter", async () => {
    const task = { id: "t", attempts: 0, maxAttempts: 3 };
    expect(await queue.failTask(task, new IntegrationError(KINDS.PERMANENT, "bad"), db)).toBe("Failed");
    expect(await queue.failTask(task, new IntegrationError(KINDS.AUTH_INVALID, "revoked"), db)).toBe("Failed");
    expect(await queue.failTask(task, new IntegrationError(KINDS.RATE_LIMITED, "slow", { retryAfterMs: 5000 }), db)).toBe("Retrying");
    expect(db.integrationTask.update.mock.calls.at(-1)[0].data.runAfter.getTime()).toBeGreaterThanOrEqual(Date.now() + 4000);
    expect(await queue.failTask({ ...task, attempts: 2 }, new IntegrationError(KINDS.TRANSIENT, "down"), db)).toBe("Dead Letter");
  });

  it("per-connection and per-organization throttling: busy connections and saturated orgs wait", async () => {
    db.integrationTask.findMany
      .mockResolvedValueOnce([
        { id: "a", organizationId: "o1", connectionId: "c1", createdAt: new Date(1) },
        { id: "b", organizationId: "o2", connectionId: "c9", createdAt: new Date(2) },
        { id: "c", organizationId: "o3", connectionId: "c5", createdAt: new Date(3) },
      ])
      .mockResolvedValueOnce([{ organizationId: "o1", connectionId: "c1" }, { organizationId: "o2", connectionId: "c7" }, { organizationId: "o2", connectionId: "c8" }]);
    const claimed = await queue.claimNextTask(null, db);
    expect(claimed.id).toBe("c"); // a: its connection is busy; b: o2 already runs 2
  });
});

describe("conflicts", () => {
  const conflict = { id: "k", status: "Open", fields: ["title", "margin"], restrictedFields: ["margin"], crmValues: { title: "A", margin: 5 }, providerValues: { title: "B", margin: 9 } };
  it("the provider can't overwrite restricted fields; a merge needs chosen, non-restricted fields", async () => {
    await expect(conflicts.resolveConflict({}, conflict, { resolution: "Keep Provider" })).rejects.toThrow(/restricted/);
    await expect(conflicts.resolveConflict({}, conflict, { resolution: "Merge Selected Fields", selectedFields: [] })).rejects.toThrow(/Choose/);
    await expect(conflicts.resolveConflict({}, conflict, { resolution: "Merge Selected Fields", selectedFields: ["margin"] })).rejects.toThrow(/Restricted/);
    await expect(conflicts.resolveConflict({}, conflict, { resolution: "Delete everything" })).rejects.toThrow(/resolution must be/);
    await expect(conflicts.resolveConflict({}, { ...conflict, status: "Resolved" }, { resolution: "Skip" })).rejects.toThrow(/already resolved/);
  });

  it("people without resolve or sensitive access see field names, not values", () => {
    const viewer = { isSystemOwnerOverride: false, membership: { id: "m", roles: [{ role: { defaultScope: "Organization", permissionGrants: [{ moduleId: "integration_conflicts", actions: ["view"] }] } }] } };
    const out = conflicts.serializeConflict(viewer, { ...conflict, crmValues: { title: "A" }, providerValues: { title: "B" } });
    expect(out).toMatchObject({ valuesVisible: false, crmValues: { title: "[hidden]" }, providerValues: { title: "[hidden]" } });
  });
});

describe("connection lookup", () => {
  it("the id match and the visibility rule are both applied (no OR overwrite)", async () => {
    await connections.loadConnection({ organizationId: "o", isSystemOwnerOverride: false, membership: { id: "m", roles: [{ role: { defaultScope: "Department", permissionGrants: [{ moduleId: "integration_connections", actions: ["view"] }] } }] } }, "conn_1", db);
    const where = db.integrationConnection.findFirst.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ OR: [{ publicId: "conn_1" }, { id: "conn_1" }] });
    expect(where.AND[1].OR[1]).toEqual({ connectedMembershipId: "m" });
  });
});
