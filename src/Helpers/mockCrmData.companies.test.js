import { describe, it, expect, vi } from "vitest";
import {
  createCompanyRecord,
  updateCompanyRecord,
  queryCompaniesLocal,
  findDuplicateCompanies,
  createContactRecord,
  linkContactToCompany,
  unlinkContactFromCompany,
  setPrimaryContact,
} from "./mockCrmData";

describe("mockCrmData — Companies", () => {
  it("createCompanyRecord stamps createdAt as \"now\", not a random past fixture date (regression)", () => {
    // makeCompany's fixture-seeding fallback assigns a random date up to a
    // year in the past when no createdAt is given. Without createCompanyRecord
    // explicitly passing "now", a genuinely new company would get that random
    // past date and could sort outside page 1 under createdAt-desc — making
    // it look like it was never created.
    const before = Date.now();
    const company = createCompanyRecord({ name: "Freshly Created Co" }, "Tester");
    const createdAtMs = new Date(company.createdAt).getTime();
    expect(createdAtMs).toBeGreaterThanOrEqual(before - 1000);
    expect(createdAtMs).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("updateCompanyRecord persists field changes and stamps updatedBy/updatedAt", () => {
    // Both timestamps come from new Date().toISOString(); on a fast run they
    // can land in the same millisecond, so advance a fake clock between the
    // two calls rather than relying on real wall-clock time to differ.
    vi.useFakeTimers();
    try {
      const company = createCompanyRecord({ name: "Edit Persist Co" }, "Creator");
      const before = company.updatedAt;
      vi.advanceTimersByTime(5);
      const updated = updateCompanyRecord(company._id, { industry: "Aerospace" }, "Editor");
      expect(updated.industry).toBe("Aerospace");
      expect(updated.updatedBy).toBe("Editor");
      expect(updated.updatedAt).not.toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("updateCompanyRecord logs a field-level audit entry with primitive before/after values (no circular structure)", () => {
    // Industry is pinned on create (rather than left to the random fixture
    // default) so the update below is guaranteed to be a real change —
    // otherwise a random "Retail" pick would coincidentally match and no
    // audit entry would be logged, making this test flaky.
    const company = createCompanyRecord({ name: "Audit Field Co", industry: "Technology" }, "Tester");
    const updated = updateCompanyRecord(company._id, { industry: "Retail" }, "Tester");
    const entry = updated.auditLog.find((e) => e.field === "industry");
    expect(entry).toBeTruthy();
    expect(entry.after).toBe("Retail");
    expect(() => JSON.stringify(updated)).not.toThrow();
  });

  it("updateCompanyRecord logs a lifecycle_changed activity entry when lifecycle stage changes", () => {
    const company = createCompanyRecord({ name: "Lifecycle Co", lifecycleStage: "New" }, "Tester");
    const updated = updateCompanyRecord(company._id, { lifecycleStage: "Qualified" }, "Tester");
    expect(updated.lifecycleStage).toBe("Qualified");
    expect(updated.activity.some((a) => a.type === "lifecycle_changed")).toBe(true);
  });

  it("updateCompanyRecord logs a health_changed activity entry when account health changes", () => {
    const company = createCompanyRecord({ name: "Health Co", accountHealth: "Healthy" }, "Tester");
    const updated = updateCompanyRecord(company._id, { accountHealth: "At Risk", healthReason: "Overdue invoice" }, "Tester");
    expect(updated.accountHealth).toBe("At Risk");
    expect(updated.activity.some((a) => a.type === "health_changed")).toBe(true);
  });

  it("findDuplicateCompanies matches on normalized company name", () => {
    createCompanyRecord({ name: "  Dedupe Test Corp  " }, "Tester");
    const matches = findDuplicateCompanies({ name: "dedupe test corp" });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].reasons).toContain("Same company name");
  });

  it("findDuplicateCompanies excludes a given company id (self-match while editing)", () => {
    const company = createCompanyRecord({ name: "Self Match Co" }, "Tester");
    const matches = findDuplicateCompanies({ name: "Self Match Co" }, company._id);
    expect(matches.find((m) => m.company._id === company._id)).toBeUndefined();
  });

  it("queryCompaniesLocal never returns more items than pageSize, regardless of total matches", () => {
    for (let i = 0; i < 5; i++) {
      createCompanyRecord({ name: `Page Sizing Co ${i} ${Date.now()}`, industry: "PageSizeIndustryC" }, "Tester");
    }
    const all = [...Array(5)].map((_, i) => createCompanyRecord({ name: `Extra ${i}`, industry: "PageSizeIndustryC" }, "Tester"));
    const list = [...all];
    const result = queryCompaniesLocal(list, { page: 1, pageSize: 2 });
    expect(result.companies.length).toBeLessThanOrEqual(2);
    expect(result.total).toBe(list.length);
  });

  it("queryCompaniesLocal summary counts reflect the filtered set", () => {
    const list = [
      { _id: "1", accountType: "Prospect", customerStatus: "Active", accountHealth: "Healthy", ownerId: "u1", archived: false, name: "A", primaryDomain: "", website: "", email: "", phone: "" },
      { _id: "2", accountType: "Customer", customerStatus: "Active", accountHealth: "At Risk", ownerId: null, archived: false, name: "B", primaryDomain: "", website: "", email: "", phone: "" },
    ];
    const result = queryCompaniesLocal(list, {});
    expect(result.summary.total).toBe(2);
    expect(result.summary.prospects).toBe(1);
    expect(result.summary.atRisk).toBe(1);
    expect(result.summary.unassigned).toBe(1);
  });

  it("queryCompaniesLocal excludes archived companies by default and includes them when archived=true", () => {
    const list = [
      { _id: "1", archived: false, name: "Active Co", accountType: "Prospect", primaryDomain: "", website: "", email: "", phone: "" },
      { _id: "2", archived: true, name: "Archived Co", accountType: "Prospect", primaryDomain: "", website: "", email: "", phone: "" },
    ];
    const activeResult = queryCompaniesLocal(list, {});
    expect(activeResult.companies.find((c) => c._id === "2")).toBeUndefined();
    const archivedResult = queryCompaniesLocal(list, { archived: "true" });
    expect(archivedResult.companies.find((c) => c._id === "2")).toBeDefined();
  });

  it("linkContactToCompany / unlinkContactFromCompany / setPrimaryContact update the contact's companyId", () => {
    const company = createCompanyRecord({ name: "Relationship Co" }, "Tester");
    const contact = createContactRecord({ firstName: "Rel", lastName: "Contact", email: "relcontact@example.com" }, "Tester");

    linkContactToCompany(company._id, contact._id, "Tester");
    expect(contact.companyId).toBe(company._id);

    setPrimaryContact(company._id, contact._id, "Tester");
    expect(company.primaryContactId).toBe(contact._id);

    unlinkContactFromCompany(company._id, contact._id, "Tester");
    expect(contact.companyId).toBeNull();
    expect(company.primaryContactId).toBeNull();
  });
});
