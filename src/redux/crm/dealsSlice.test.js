import { describe, it, expect } from "vitest";
import dealsReducer, { fetchDeals, fetchDeal, createDeal, changeDealStage, markDealWon } from "./dealsSlice";

const initialState = dealsReducer(undefined, { type: "@@INIT" });

describe("dealsSlice", () => {
  it("fetchDeals.fulfilled stores the full list (deliberately not paginated)", () => {
    // Like Companies/Activities, this stays unpaginated at the Redux layer —
    // CompaniesList and the CRM dashboard already consume the full list.
    const payload = [{ _id: "1" }, { _id: "2" }, { _id: "3" }];
    const state = dealsReducer(initialState, { type: fetchDeals.fulfilled.type, payload });
    expect(state.items).toHaveLength(3);
  });

  it("fetchDeal.rejected sets a not-found flag instead of an infinite loading state", () => {
    const withCurrent = { ...initialState, current: { _id: "1", name: "Stale" } };
    const state = dealsReducer(withCurrent, { type: fetchDeal.rejected.type, payload: "Deal not found" });
    expect(state.current).toBeNull();
    expect(state.currentNotFound).toBe(true);
  });

  it("fetchDeal.fulfilled populates current and clears the not-found flag", () => {
    const withNotFound = { ...initialState, currentNotFound: true };
    const deal = { _id: "1", name: "Expansion deal" };
    const state = dealsReducer(withNotFound, { type: fetchDeal.fulfilled.type, payload: deal });
    expect(state.current).toEqual(deal);
    expect(state.currentNotFound).toBe(false);
  });

  it("createDeal.fulfilled unshifts the new deal", () => {
    const withItems = { ...initialState, items: [{ _id: "old" }] };
    const action = { type: createDeal.fulfilled.type, payload: { _id: "new" } };
    const state = dealsReducer(withItems, action);
    expect(state.items[0]._id).toBe("new");
    expect(state.items).toHaveLength(2);
  });

  it("changeDealStage.fulfilled and markDealWon.fulfilled update both the list item and current", () => {
    const withBoth = { ...initialState, items: [{ _id: "1", stage: "Discovery" }], current: { _id: "1", stage: "Discovery" } };
    const staged = dealsReducer(withBoth, { type: changeDealStage.fulfilled.type, payload: { _id: "1", stage: "Proposal" } });
    expect(staged.items[0].stage).toBe("Proposal");
    expect(staged.current.stage).toBe("Proposal");
    const won = dealsReducer(staged, { type: markDealWon.fulfilled.type, payload: { _id: "1", stage: "Won", status: "Won" } });
    expect(won.items[0].status).toBe("Won");
    expect(won.current.status).toBe("Won");
  });
});
