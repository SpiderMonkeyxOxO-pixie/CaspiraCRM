import { describe, it, expect } from "vitest";
import activitiesReducer, { fetchActivities, fetchActivity, createActivity } from "./activitiesSlice";

const initialState = activitiesReducer(undefined, { type: "@@INIT" });

describe("activitiesSlice", () => {
  it("fetchActivities.fulfilled stores the full filtered list (deliberately not paginated)", () => {
    // Like Companies, this stays unpaginated at the Redux layer — Agenda and
    // Calendar views need visibility across the whole filtered set; the
    // Table view paginates client-side via queryActivitiesLocal.
    const payload = [{ _id: "1" }, { _id: "2" }, { _id: "3" }];
    const state = activitiesReducer(initialState, { type: fetchActivities.fulfilled.type, payload });
    expect(state.items).toHaveLength(3);
  });

  it("fetchActivity.rejected sets a not-found flag instead of an infinite loading state", () => {
    const withCurrent = { ...initialState, current: { _id: "1", title: "Stale" } };
    const state = activitiesReducer(withCurrent, { type: fetchActivity.rejected.type, payload: "Activity not found" });
    expect(state.current).toBeNull();
    expect(state.currentNotFound).toBe(true);
  });

  it("fetchActivity.fulfilled populates current and clears the not-found flag", () => {
    const withNotFound = { ...initialState, currentNotFound: true };
    const activity = { _id: "1", title: "Discovery call" };
    const state = activitiesReducer(withNotFound, { type: fetchActivity.fulfilled.type, payload: activity });
    expect(state.current).toEqual(activity);
    expect(state.currentNotFound).toBe(false);
  });

  it("createActivity.fulfilled unshifts the new activity and stores any conflicts", () => {
    const withItems = { ...initialState, items: [{ _id: "old" }] };
    const conflict = { _id: "conflicting", title: "Overlapping call" };
    const action = { type: createActivity.fulfilled.type, payload: { activity: { _id: "new" }, conflicts: [conflict] } };
    const state = activitiesReducer(withItems, action);
    expect(state.items[0]._id).toBe("new");
    expect(state.items).toHaveLength(2);
    expect(state.lastCreatedConflicts).toEqual([conflict]);
  });
});
