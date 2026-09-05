import { describe, it, expect } from "vitest";
import leadsReducer, {
  fetchLeads,
  fetchLead,
  createLead,
  clearLeadDuplicates,
} from "./leadsSlice";

const initialState = leadsReducer(undefined, { type: "@@INIT" });

describe("leadsSlice", () => {
  it("fetchLeads.fulfilled stores exactly one page, not the full dataset", () => {
    const payload = {
      leads: [{ _id: "1" }, { _id: "2" }],
      total: 37,
      page: 2,
      pageSize: 2,
      summary: { total: 37, open: 30, new: 5, qualified: 4, followUpsDue: 1, overdueFollowUps: 0, conversionRate: 10 },
    };
    const state = leadsReducer(initialState, { type: fetchLeads.fulfilled.type, payload });
    expect(state.items).toHaveLength(2);
    expect(state.total).toBe(37);
    expect(state.page).toBe(2);
    expect(state.summary.conversionRate).toBe(10);
  });

  it("fetchLead.rejected sets a not-found flag instead of leaving the page stuck on an infinite spinner (regression)", () => {
    // Mock data lives only in memory and is reseeded on every full page
    // load, so a bookmarked/shared lead URL frequently 404s. LeadDetail.jsx
    // used to have no dedicated "not found" state, so a rejected fetchLead
    // just left `current` null forever with no way to distinguish
    // "still loading" from "will never load".
    const withCurrent = { ...initialState, current: { _id: "1", name: "Stale" } };
    const state = leadsReducer(withCurrent, { type: fetchLead.rejected.type, payload: "Lead not found" });
    expect(state.current).toBeNull();
    expect(state.currentNotFound).toBe(true);
  });

  it("fetchLead.pending clears any previous lead and the not-found flag", () => {
    const withNotFound = { ...initialState, current: null, currentNotFound: true };
    const state = leadsReducer(withNotFound, { type: fetchLead.pending.type });
    expect(state.current).toBeNull();
    expect(state.currentNotFound).toBe(false);
  });

  it("fetchLead.fulfilled populates current and clears the not-found flag", () => {
    const withNotFound = { ...initialState, currentNotFound: true };
    const lead = { _id: "1", name: "Jordan Rivera" };
    const state = leadsReducer(withNotFound, { type: fetchLead.fulfilled.type, payload: lead });
    expect(state.current).toEqual(lead);
    expect(state.currentNotFound).toBe(false);
  });

  it("createLead.rejected with a validation-error payload does not populate duplicates", () => {
    // The 400 validation shape is { message, errors }, not { duplicates } —
    // this must not be confused with the 409 duplicate-detection shape.
    const action = {
      type: createLead.rejected.type,
      payload: { message: "Validation failed", errors: { name: "Provide a person name or a company name" } },
    };
    const state = leadsReducer(initialState, action);
    expect(state.duplicates).toEqual([]);
  });

  it("createLead.rejected with a 409 duplicate payload populates duplicates", () => {
    const dup = { lead: { _id: "1", name: "Existing Lead" }, reasons: ["Same email address"] };
    const action = {
      type: createLead.rejected.type,
      payload: { message: "A possible duplicate lead already exists", duplicates: [dup] },
    };
    const state = leadsReducer(initialState, action);
    expect(state.duplicates).toEqual([dup]);
  });

  it("createLead.fulfilled unshifts the new lead, increments total, and clears duplicates", () => {
    const withDupes = { ...initialState, items: [{ _id: "old" }], total: 1, duplicates: [{ lead: {}, reasons: [] }] };
    const newLead = { _id: "new" };
    const state = leadsReducer(withDupes, { type: createLead.fulfilled.type, payload: newLead });
    expect(state.items[0]._id).toBe("new");
    expect(state.items).toHaveLength(2);
    expect(state.total).toBe(2);
    expect(state.duplicates).toEqual([]);
  });

  it("clearLeadDuplicates resets duplicates to empty", () => {
    const withDupes = { ...initialState, duplicates: [{ lead: {}, reasons: ["x"] }] };
    const state = leadsReducer(withDupes, clearLeadDuplicates());
    expect(state.duplicates).toEqual([]);
  });
});
