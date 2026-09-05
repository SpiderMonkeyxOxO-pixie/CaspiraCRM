import { describe, it, expect } from "vitest";
import companiesReducer, {
  fetchCompanies,
  fetchCompany,
  createCompany,
  clearCompanyDuplicates,
} from "./companiesSlice";

const initialState = companiesReducer(undefined, { type: "@@INIT" });

describe("companiesSlice", () => {
  it("fetchCompanies.fulfilled stores the full list (deliberately not paginated)", () => {
    // Unlike Leads/Contacts, Companies stays unpaginated at the Redux layer
    // — Support, Finance, Projects, Marketing Segments and the CRM
    // dashboard all consume this same full list; pagination happens
    // client-side in CompaniesList.jsx via queryCompaniesLocal.
    const payload = [{ _id: "1" }, { _id: "2" }, { _id: "3" }];
    const state = companiesReducer(initialState, { type: fetchCompanies.fulfilled.type, payload });
    expect(state.items).toHaveLength(3);
  });

  it("fetchCompany.rejected sets a not-found flag instead of an infinite loading state", () => {
    const withCurrent = { ...initialState, current: { _id: "1", name: "Stale" } };
    const state = companiesReducer(withCurrent, { type: fetchCompany.rejected.type, payload: "Company not found" });
    expect(state.current).toBeNull();
    expect(state.currentNotFound).toBe(true);
  });

  it("fetchCompany.fulfilled populates current and clears the not-found flag", () => {
    const withNotFound = { ...initialState, currentNotFound: true };
    const company = { _id: "1", name: "Acme Inc" };
    const state = companiesReducer(withNotFound, { type: fetchCompany.fulfilled.type, payload: company });
    expect(state.current).toEqual(company);
    expect(state.currentNotFound).toBe(false);
  });

  it("createCompany.rejected with a validation-error payload does not populate duplicates", () => {
    const action = {
      type: createCompany.rejected.type,
      payload: { message: "Validation failed", errors: { name: "Company name is required" } },
    };
    const state = companiesReducer(initialState, action);
    expect(state.duplicates).toEqual([]);
  });

  it("createCompany.rejected with a 409 duplicate payload populates duplicates", () => {
    const dup = { company: { _id: "1", name: "Existing Co" }, reasons: ["Same company name"] };
    const action = {
      type: createCompany.rejected.type,
      payload: { message: "A possible duplicate company already exists", duplicates: [dup] },
    };
    const state = companiesReducer(initialState, action);
    expect(state.duplicates).toEqual([dup]);
  });

  it("createCompany.fulfilled unshifts the new company and clears duplicates", () => {
    const withDupes = { ...initialState, items: [{ _id: "old" }], duplicates: [{ company: {}, reasons: [] }] };
    const newCompany = { _id: "new" };
    const state = companiesReducer(withDupes, { type: createCompany.fulfilled.type, payload: newCompany });
    expect(state.items[0]._id).toBe("new");
    expect(state.items).toHaveLength(2);
    expect(state.duplicates).toEqual([]);
  });

  it("clearCompanyDuplicates resets duplicates to empty", () => {
    const withDupes = { ...initialState, duplicates: [{ company: {}, reasons: ["x"] }] };
    const state = companiesReducer(withDupes, clearCompanyDuplicates());
    expect(state.duplicates).toEqual([]);
  });
});
