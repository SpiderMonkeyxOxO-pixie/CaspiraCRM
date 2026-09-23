import { describe, it, expect } from "vitest";
import { toUiTicket, toApiTicket, BACKEND_ENABLED } from "./supportTicketsBackend";

describe("supportTicketsBackend shape translation", () => {
  it("is off under test regardless of the developer's .env", () => {
    expect(BACKEND_ENABLED).toBe(false);
  });

  it("maps related records onto the ticket UI's names and arrays", () => {
    const owners = new Map([["m1", { id: "m1", name: "Sam Rep" }]]);
    const ui = toUiTicket(
      {
        _id: "t1", ticketNumber: "TICKET-2026-000001", assignedMembershipId: "m1", resolutionSummary: "Reset password", resolvedAt: "2026-09-02T00:00:00.000Z",
        company: { _id: "co1", name: "Northwind" }, contact: null,
        messages: [
          { _id: "r1", kind: "Reply", body: "On it", authorMembershipId: "m1", createdAt: "2026-09-01T01:00:00.000Z" },
          { _id: "n1", kind: "Note", body: "VIP", authorMembershipId: "m1", createdAt: "2026-09-01T02:00:00.000Z" },
        ],
        escalationEvents: [{ fromDepartment: "Support", toDepartment: "Technical", reason: "Bug", createdAt: "2026-09-01T03:00:00.000Z" }],
      },
      owners,
    );
    expect(ui).toMatchObject({ companyName: "Northwind", contactName: "Unknown", assignedAgent: "Sam Rep", assignedAgentId: "m1" });
    expect(ui.publicReplies).toEqual([{ _id: "r1", message: "On it", author: "Sam Rep", at: "2026-09-01T01:00:00.000Z" }]);
    expect(ui.privateNotes.map((n) => n.message)).toEqual(["VIP"]);
    expect(ui.escalations).toEqual([{ from: "Support", to: "Technical", reason: "Bug", at: "2026-09-01T03:00:00.000Z" }]);
    expect(ui.resolution).toEqual({ summary: "Reset password", resolvedAt: "2026-09-02T00:00:00.000Z" });
  });

  it("sends only real ticket fields on create (never names, status or SLA)", () => {
    expect(toApiTicket({ subject: "S", priority: "High", companyName: "X", status: "Closed", slaResponseDeadline: "x", contactId: "" })).toEqual({
      subject: "S", priority: "High", contactId: null,
    });
  });
});
