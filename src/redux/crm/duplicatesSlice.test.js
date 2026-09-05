import { describe, it, expect, beforeAll } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import leadsReducer from "./leadsSlice";
import contactsReducer from "./contactsSlice";
import companiesReducer from "./companiesSlice";
import dealsReducer from "./dealsSlice";
import duplicatesReducer, {
  runFrontendScan, applyMergePreview, undoMergePreview,
  markNotDuplicate, deferReview, assignReviewer, bulkMarkForReview, bulkMarkNotDuplicate,
} from "./duplicatesSlice";
import { leads, queryLeads, findLead } from "../../Helpers/mockCrmData";

const bareState = duplicatesReducer(undefined, { type: "@@INIT" });

describe("duplicatesSlice — reducers", () => {
  it("markNotDuplicate sets status and reason on the target group only", () => {
    const state = { ...bareState, groups: [{ id: "g1", reviewStatus: "Needs Review" }, { id: "g2", reviewStatus: "Needs Review" }] };
    const next = duplicatesReducer(state, markNotDuplicate({ groupId: "g1", reason: "Different people" }));
    expect(next.groups[0].reviewStatus).toBe("Not Duplicate");
    expect(next.groups[0].notDuplicateReason).toBe("Different people");
    expect(next.groups[1].reviewStatus).toBe("Needs Review");
  });

  it("deferReview sets Deferred status plus reviewer/date/note, distinct from a resolved status", () => {
    const state = { ...bareState, groups: [{ id: "g1", reviewStatus: "New", assignedReviewer: null }] };
    const next = duplicatesReducer(state, deferReview({ groupId: "g1", reviewer: "u2", reviewDate: "2026-09-01", note: "Waiting on sales" }));
    expect(next.groups[0].reviewStatus).toBe("Deferred");
    expect(next.groups[0].assignedReviewer).toBe("u2");
    expect(next.groups[0].deferredReviewDate).toBe("2026-09-01");
  });

  it("assignReviewer only changes the reviewer, not the review status", () => {
    const state = { ...bareState, groups: [{ id: "g1", reviewStatus: "Needs Review", assignedReviewer: null }] };
    const next = duplicatesReducer(state, assignReviewer({ groupId: "g1", reviewerId: "u3" }));
    expect(next.groups[0].assignedReviewer).toBe("u3");
    expect(next.groups[0].reviewStatus).toBe("Needs Review");
  });

  it("bulkMarkForReview resets multiple groups to Needs Review but never touches a resolved group", () => {
    const state = {
      ...bareState,
      groups: [
        { id: "g1", reviewStatus: "Deferred" },
        { id: "g2", reviewStatus: "Not Duplicate" },
        { id: "g3", reviewStatus: "New" },
      ],
    };
    const next = duplicatesReducer(state, bulkMarkForReview({ groupIds: ["g1", "g2", "g3"] }));
    expect(next.groups[0].reviewStatus).toBe("Needs Review");
    expect(next.groups[1].reviewStatus).toBe("Not Duplicate"); // untouched
    expect(next.groups[2].reviewStatus).toBe("Needs Review");
  });

  it("bulkMarkNotDuplicate applies the same reason to every selected group", () => {
    const state = { ...bareState, groups: [{ id: "g1", reviewStatus: "New" }, { id: "g2", reviewStatus: "New" }] };
    const next = duplicatesReducer(state, bulkMarkNotDuplicate({ groupIds: ["g1", "g2"], reason: "Shared phone number" }));
    expect(next.groups.every((g) => g.reviewStatus === "Not Duplicate" && g.notDuplicateReason === "Shared phone number")).toBe(true);
  });

  it("runFrontendScan.rejected sets an error status without discarding existing groups", () => {
    const state = { ...bareState, groups: [{ id: "g1" }], scan: { status: "running", lastScanAt: null, summary: null, error: null } };
    const next = duplicatesReducer(state, { type: runFrontendScan.rejected.type, error: { message: "boom" } });
    expect(next.scan.status).toBe("error");
    expect(next.scan.error).toBe("boom");
    expect(next.groups).toHaveLength(1);
  });
});

describe("duplicatesSlice — applyMergePreview / undoMergePreview (integration, real update thunks + mock API)", () => {
  // The mock API's PUT /crm/leads/:id (and every other CRM write endpoint)
  // gates on a CRM-capable role read from localStorage — without this,
  // every update thunk gets a real 403 and the whole merge silently fails.
  beforeAll(() => {
    localStorage.setItem("role", "Super-Admin");
  });

  function makeStore() {
    return configureStore({
      reducer: { leads: leadsReducer, contacts: contactsReducer, companies: companiesReducer, deals: dealsReducer, duplicates: duplicatesReducer },
    });
  }

  it("applying a merge marks the absorbed Lead as preview-merged and hides it from queryLeads, leaving the master untouched", async () => {
    const store = makeStore();
    const [master, absorbed] = leads;
    expect(queryLeads({ search: absorbed.email, pageSize: 100 }).leads.some((l) => l._id === absorbed._id)).toBe(true);

    const action = await store.dispatch(applyMergePreview({
      groupId: "test-group", masterType: "leads", masterId: master._id,
      absorbedRecords: [{ type: "leads", id: absorbed._id }], finalValues: {}, reason: "Test merge",
    }));
    expect(applyMergePreview.fulfilled.match(action)).toBe(true);

    expect(queryLeads({ search: absorbed.email, pageSize: 100 }).leads.some((l) => l._id === absorbed._id)).toBe(false);
    expect(findLead(master._id).previewMergedInto).toBeUndefined();

    // Regression: Undo must fully clear previewMergedInto/previewMergedAt —
    // Object.assign (the real update path) only overwrites keys present in
    // `changes`, so restoring a pre-merge snapshot that never had these keys
    // must explicitly null them out, or the record stays hidden forever.
    const historyEntry = store.getState().duplicates.mergeHistory[0];
    const undoAction = await store.dispatch(undoMergePreview(historyEntry.id));
    expect(undoMergePreview.fulfilled.match(undoAction)).toBe(true);

    expect(queryLeads({ search: absorbed.email, pageSize: 100 }).leads.some((l) => l._id === absorbed._id)).toBe(true);
  });

  it("applyMergePreview writes the group's reviewStatus to Preview Resolved and records session-scoped merge history", async () => {
    const dupState = { ...bareState, groups: [{ id: "g-test", recordType: "leads", reviewStatus: "Confirmed Duplicate" }], mergeHistory: [], groupStatusBeforeMerge: {} };
    const preloaded = configureStore({
      reducer: { leads: leadsReducer, contacts: contactsReducer, companies: companiesReducer, deals: dealsReducer, duplicates: duplicatesReducer },
      preloadedState: { duplicates: dupState },
    });
    // Use a different pair of fixture Leads than the previous test — that
    // test's absorbed Lead may still carry previewMergedInto if an earlier
    // assertion in this file failed before its own undo ran.
    const [master, absorbed] = [leads[2], leads[3]];
    const applyAction = await preloaded.dispatch(applyMergePreview({
      groupId: "g-test", masterType: "leads", masterId: master._id,
      absorbedRecords: [{ type: "leads", id: absorbed._id }], finalValues: {}, reason: "Test merge",
    }));
    expect(applyMergePreview.fulfilled.match(applyAction)).toBe(true);
    const state = preloaded.getState().duplicates;
    expect(state.groups.find((g) => g.id === "g-test").reviewStatus).toBe("Preview Resolved");
    expect(state.mergeHistory).toHaveLength(1);
    expect(state.mergeHistory[0].reason).toBe("Test merge");
    expect(state.mergeHistory[0].undone).toBe(false);

    const undoAction = await preloaded.dispatch(undoMergePreview(state.mergeHistory[0].id));
    expect(undoMergePreview.fulfilled.match(undoAction)).toBe(true);
    const afterUndo = preloaded.getState().duplicates;
    expect(afterUndo.mergeHistory[0].undone).toBe(true);
    expect(afterUndo.groups.find((g) => g.id === "g-test").reviewStatus).toBe("Confirmed Duplicate");
  });
});
