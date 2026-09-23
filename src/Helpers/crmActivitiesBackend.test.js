import { describe, it, expect } from "vitest";
import { toUiActivity, toApiActivity, BACKEND_ENABLED } from "./crmActivitiesBackend";

describe("crmActivitiesBackend shape translation", () => {
  it("is off under test regardless of the developer's .env", () => {
    expect(BACKEND_ENABLED).toBe(false);
  });

  it("derives the related record type/id/label from whichever foreign key is set", () => {
    const owners = new Map([["m1", { id: "m1", name: "Sam Rep" }]]);
    const ui = toUiActivity(
      {
        _id: "a1", title: "Call", ownerMembershipId: "m1", contactId: "c1", contact: { _id: "c1", name: "Elena Vasquez" },
        scheduledStart: "2026-10-01T09:00:00.000Z", scheduledEnd: "2026-10-01T09:30:00.000Z", timeZone: "UTC", team: "Enterprise",
        followUpActivityId: "a0", participants: null,
      },
      owners,
    );
    expect(ui).toMatchObject({
      ownerId: "m1", ownerName: "Sam Rep", relatedRecordType: "Contact", relatedRecordId: "c1", relatedRecordLabel: "Elena Vasquez",
      startAt: "2026-10-01T09:00:00.000Z", endAt: "2026-10-01T09:30:00.000Z", timezone: "UTC", assignedTeam: "Enterprise",
      parentActivityId: "a0", participants: [],
    });
  });

  it("maps the related record back to exactly one foreign key and the owner to owner + assignee", () => {
    expect(toApiActivity({ relatedRecordType: "Deal", relatedRecordId: "d1", ownerId: "m2", startAt: "2026-10-01", relatedRecordLabel: "x" })).toEqual({
      leadId: null, contactId: null, companyId: null, dealId: "d1", ownerMembershipId: "m2", assignedMembershipId: "m2", scheduledStart: "2026-10-01",
    });
  });

  it("leaves relations untouched when the change doesn't mention them", () => {
    expect(toApiActivity({ title: "Renamed" })).toEqual({ title: "Renamed" });
  });
});
