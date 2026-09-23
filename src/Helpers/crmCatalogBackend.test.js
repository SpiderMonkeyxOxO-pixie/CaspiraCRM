import { describe, it, expect } from "vitest";
import { toUiProduct, toApiProduct, toUiPriceBook, toApiPriceBook, BACKEND_ENABLED } from "./crmCatalogBackend";
import { findTeamMember, registerTeamMembers } from "./mockUsersData";

describe("crmCatalogBackend shape translation", () => {
  it("is off under test regardless of the developer's .env", () => {
    expect(BACKEND_ENABLED).toBe(false);
  });

  it("maps a catalog item's owner and money fields to plain numbers", () => {
    const ui = toUiProduct({ _id: "i1", name: "License", ownerMembershipId: "m1", standardPrice: "90.00", costPreview: null, tags: null }, new Map([["m1", { id: "m1", name: "Org Admin" }]]));
    expect(ui).toMatchObject({ ownerId: "m1", ownerName: "Org Admin", standardPrice: 90, costPreview: null, tags: [] });
    expect(toApiProduct({ name: "X", ownerId: "m1", ownerName: "Org Admin", archived: true })).toEqual({ name: "X", ownerMembershipId: "m1" });
  });

  it("exposes a price book's entries as `items` and never sends them with the book's own fields", () => {
    const ui = toUiPriceBook({ _id: "pb1", name: "EU", entries: [{ _id: "e1", catalogItemId: "i1", adjustmentValue: "10.00", tiers: null }], companyIds: null });
    expect(ui.items).toEqual([{ _id: "e1", catalogItemId: "i1", adjustmentValue: 10, tiers: [] }]);
    expect(ui.companyIds).toEqual([]);
    expect(ui).not.toHaveProperty("entries");
    expect(toApiPriceBook({ name: "EU", items: [{}], ownerId: "" })).toEqual({ name: "EU", ownerMembershipId: null });
  });

  it("resolves registered real members by id in the shared owner-name lookup", () => {
    registerTeamMembers([{ id: "membership-123", name: "Priya Nair" }]);
    expect(findTeamMember("membership-123")?.name).toBe("Priya Nair");
  });
});
