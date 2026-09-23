import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
  project: { findFirst: vi.fn(), update: vi.fn() },
  deliverable: { findFirst: vi.fn(), findUnique: vi.fn(async () => ({ id: "d1" })), update: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn() },
  deliverableDecision: { create: vi.fn() },
  projectRisk: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  projectIssue: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  changeRequest: { findFirst: vi.fn(), findUnique: vi.fn(async () => ({ id: "cr1", status: "Implemented" })), update: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn() },
  projectBaseline: { findFirst: vi.fn(), create: vi.fn() },
  projectPhase: { findMany: vi.fn(async () => []) },
  milestone: { findMany: vi.fn(async () => []), findFirst: vi.fn() },
  task: { findMany: vi.fn(async () => []), update: vi.fn(), findFirst: vi.fn() },
  ticket: { findFirst: vi.fn() },
  organizationMembership: { findFirst: vi.fn(async () => ({ id: "m" })) },
  projectActivity: { create: vi.fn() },
  salesDocumentCounter: { upsert: vi.fn(), update: vi.fn(async () => ({ value: 1 })) },
};
db.$transaction = vi.fn(async (arg) => (typeof arg === "function" ? arg(db) : Promise.all(arg)));
vi.mock("../../lib/prisma.js", () => ({ default: db }));
vi.mock("../../services/auditService.js", () => ({ recordAuditEvent: vi.fn(), requestContext: () => ({}) }));

const gov = await import("./governanceController.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
const req = (body = {}, params = {}, { membershipId = "m1", grants = { projects: ["view", "edit"] } } = {}) => ({
  body, params: { projectId: "p1", ...params }, query: {}, organizationId: "org1", user: { id: "u1" }, isSystemOwnerOverride: false,
  membership: { id: membershipId, roles: [{ role: { defaultScope: "Organization", permissionGrants: Object.entries(grants).map(([moduleId, actions]) => ({ moduleId, actions })) } }] },
});
const PROJECT = { id: "p1", organizationId: "org1", ownerMembershipId: "m1", dueDate: new Date("2026-12-01"), members: [{ membershipId: "m1", role: "Project Manager", active: true, accessLevel: "Edit" }] };

beforeEach(() => {
  for (const m of Object.values(db)) if (typeof m === "object") for (const fn of Object.values(m)) fn.mockClear?.();
  db.project.findFirst.mockResolvedValue(PROJECT);
});

describe("deliverables", () => {
  it("owners can't review, accept or reject their own deliverable", async () => {
    db.deliverable.findFirst.mockResolvedValue({ id: "d1", status: "Ready for Review", ownerMembershipId: "m1", version: 1, currentVersionNumber: 1 });
    const res = mockRes();
    await gov.approveDeliverable(req({}, { deliverableId: "d1" }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe("PROJECTS_SEPARATION_OF_DUTIES");
  });

  it("requesting changes needs a comment; customer-visible ones are accepted by the customer", async () => {
    db.deliverable.findFirst.mockResolvedValue({ id: "d1", status: "Ready for Review", ownerMembershipId: "m2", version: 1, currentVersionNumber: 1 });
    const noComment = mockRes();
    await gov.requestDeliverableChanges(req({}, { deliverableId: "d1" }), noComment);
    expect(noComment.status).toHaveBeenCalledWith(400);

    db.deliverable.findFirst.mockResolvedValue({ id: "d1", status: "Approved Internally", ownerMembershipId: "m2", customerVisible: true, version: 1, currentVersionNumber: 1 });
    const internal = mockRes();
    await gov.acceptDeliverable(req({}, { deliverableId: "d1" }), internal);
    expect(internal.status).toHaveBeenCalledWith(400);
  });

  it("a material change after approval creates a new version (history kept)", async () => {
    db.deliverable.findFirst.mockResolvedValue({ id: "d1", status: "Approved Internally", ownerMembershipId: "m1", name: "Spec", description: "v1", version: 3, currentVersionNumber: 1 });
    await gov.updateDeliverable(req({ description: "v2 with new scope" }, { deliverableId: "d1" }), mockRes());
    expect(db.deliverable.update.mock.calls[0][0].data).toMatchObject({ currentVersionNumber: 2, status: "In Progress" });
    expect(db.deliverableDecision.create.mock.calls[0][0].data).toMatchObject({ decision: "New Version", versionNumber: 2 });
  });
});

describe("risks and issues", () => {
  it("risk levels are categorical; accepting needs a reason", async () => {
    const bad = mockRes();
    await gov.createRisk(req({ title: "Vendor delay", probabilityLevel: "0.73" }), bad);
    expect(bad.status).toHaveBeenCalledWith(400);
    const noReason = mockRes();
    await gov.acceptRisk(req({}, { riskId: "r1" }), noReason);
    expect(noReason.status).toHaveBeenCalledWith(400);
  });

  it("issues resolve with a summary and may link a ticket from the same organization only", async () => {
    db.ticket.findFirst.mockResolvedValue(null);
    const res = mockRes();
    await gov.createIssue(req({ title: "API outage", relatedTicketId: "other-org-ticket" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    const noSummary = mockRes();
    await gov.resolveIssue(req({}, { issueId: "i1" }), noSummary);
    expect(noSummary.status).toHaveBeenCalledWith(400);
  });
});

describe("change requests", () => {
  it("the requester can't approve their own; approval doesn't change the project", async () => {
    db.changeRequest.findFirst.mockResolvedValue({ id: "cr1", status: "Submitted", requestedByMembershipId: "m1", version: 1, scheduleImpact: { newPlannedEndDate: "2027-01-15" } });
    const own = mockRes();
    await gov.approveChange(req({}, { changeId: "cr1" }), own);
    expect(own.status).toHaveBeenCalledWith(403);

    db.changeRequest.findFirst.mockResolvedValue({ id: "cr1", status: "Submitted", requestedByMembershipId: "m2", version: 1, scheduleImpact: { newPlannedEndDate: "2027-01-15" } });
    await gov.approveChange(req({ reason: "Worth it" }, { changeId: "cr1" }), mockRes());
    expect(db.changeRequest.updateMany.mock.calls[0][0].data).toMatchObject({ status: "Approved", approvedByMembershipId: "m1" });
    expect(db.project.update).not.toHaveBeenCalled();
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it("applying needs an approved request and explicit confirmation", async () => {
    const noConfirm = mockRes();
    await gov.applyChange(req({}, { changeId: "cr1" }), noConfirm);
    expect(noConfirm.status).toHaveBeenCalledWith(400);

    db.changeRequest.findFirst.mockResolvedValue({ id: "cr1", status: "Approved", scheduleImpact: { newPlannedEndDate: "2027-01-15" }, changeNumber: "CHANGE-2026-000001" });
    await gov.applyChange(req({ confirm: true }, { changeId: "cr1" }), mockRes());
    expect(db.project.update.mock.calls[0][0].data.dueDate).toEqual(new Date("2027-01-15"));
    expect(db.changeRequest.update.mock.calls[0][0].data).toMatchObject({ status: "Implemented" });
  });

  it("budget impact is hidden and can't be set without the financial-fields grant", async () => {
    const res = mockRes();
    await gov.createChange(req({ title: "Extra module", budgetImpact: 5000 }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("baselines", () => {
  it("need a reason; numbering continues from the last one", async () => {
    const res = mockRes();
    await gov.createBaseline(req({}), res);
    expect(res.status).toHaveBeenCalledWith(400);
    db.projectBaseline.findFirst.mockResolvedValue({ baselineNumber: 2 });
    db.projectBaseline.create.mockImplementation(({ data }) => ({ id: "b3", ...data }));
    await gov.createBaseline(req({ reason: "Re-plan after CR" }), mockRes());
    expect(db.projectBaseline.create.mock.calls[0][0].data).toMatchObject({ baselineNumber: 3, reason: "Re-plan after CR" });
    expect(db.projectBaseline.create.mock.calls[0][0].data.snapshot).toHaveProperty("tasks");
  });
});
