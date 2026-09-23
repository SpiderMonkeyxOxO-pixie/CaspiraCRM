import { describe, it, expect } from "vitest";
import { toUiLead, toApiLead, BACKEND_CRM_MODE_ENABLED } from "./crmLeadsBackend";

describe("crmLeadsBackend shape translation", () => {
  it("is off under test regardless of the developer's .env", () => {
    expect(BACKEND_CRM_MODE_ENABLED).toBe(false);
  });

  it("maps an API lead onto the fields the Leads UI reads", () => {
    const owners = new Map([["m1", { id: "m1", name: "Priya Nair" }]]);
    const notes = [{ _id: "n1", authorMembershipId: "m1", body: "Called, left voicemail", createdAt: "2026-09-02T10:00:00.000Z" }];
    const ui = toUiLead(
      {
        _id: "l1", name: "Tom Reilly", ownerMembershipId: "m1", nextActionDate: "2026-10-01T00:00:00.000Z",
        description: "Warm intro", createdAt: "2026-09-01T00:00:00.000Z", convertedCompanyId: "c1", convertedContactId: "p1",
        tasks: [], files: [],
      },
      owners,
      notes,
    );

    expect(ui).toMatchObject({
      ownerId: "m1",
      ownerName: "Priya Nair",
      nextFollowUp: "2026-10-01T00:00:00.000Z",
      notes: "Warm intro",
      convertedTo: { companyId: "c1", contactId: "p1", dealId: undefined },
    });
    expect(ui.activity.map((a) => a.type)).toEqual(["created", "note"]);
    expect(ui.activity[1]).toMatchObject({ actor: "Priya Nair", description: "Called, left voicemail" });
  });

  it("leaves an unowned, unconverted lead as Unassigned with no conversion", () => {
    const ui = toUiLead({ _id: "l2", createdAt: "2026-09-01T00:00:00.000Z" });
    expect(ui.ownerId).toBeNull();
    expect(ui.ownerName).toBeNull();
    expect(ui.convertedTo).toBeNull();
    expect(ui.notes).toBe("");
  });

  it("renames UI form fields to API fields and clears an emptied owner", () => {
    expect(toApiLead({ ownerId: "m2", nextFollowUp: "2026-10-01", notes: "text", status: "New" })).toEqual({
      ownerMembershipId: "m2", nextActionDate: "2026-10-01", description: "text", status: "New",
    });
    expect(toApiLead({ ownerId: "" })).toEqual({ ownerMembershipId: null });
    expect(toApiLead({ status: "Qualified" })).toEqual({ status: "Qualified" });
  });
});
