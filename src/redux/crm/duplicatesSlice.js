// Frontend-only duplicate-management state — every group, scan result and
// merge decision here lives only for the current browser session. Merges
// are applied by dispatching the SAME update thunks every other CRM route
// already uses (updateLead/updateContact/updateCompany/updateDeal), so a
// merged master is written through the one real, tested update pathway
// instead of a second bespoke persistence path.
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import {
  leads as allLeads, contacts as allContacts, companies as allCompanies, deals as allDeals,
  findLead, findContact, findCompany, findDeal,
} from "../../Helpers/mockCrmData";
import { findCandidateClusters, mergeScanResultsIntoGroups } from "../../pages/CRM/Duplicates/duplicateMatching";
import { SEED_DUPLICATE_GROUPS, SEED_MERGE_HISTORY } from "../../pages/CRM/Duplicates/duplicateGroupFixtures";
import { updateLead } from "./leadsSlice";
import { updateContact } from "./contactsSlice";
import { updateCompany } from "./companiesSlice";
import { updateDeal } from "./dealsSlice";

const UPDATE_THUNKS = { leads: updateLead, contacts: updateContact, companies: updateCompany, deals: updateDeal };
const FINDERS = { leads: findLead, contacts: findContact, companies: findCompany, deals: findDeal };
let historySeq = 0;

// Simulated, honest progress — real work (a full pairwise scan over the
// shared fixtures) with a small visible delay per record type, never an
// instant fake completion and never claiming this scanned production data.
export const runFrontendScan = createAsyncThunk("crm/duplicates/scan", async (_args, { getState }) => {
  const startedAt = Date.now();
  const { groups: existingGroups } = getState().duplicates;
  let groups = existingGroups;
  let newGroupCount = 0;
  let updatedGroupCount = 0;
  const ENTITY_LISTS = { leads: allLeads, contacts: allContacts, companies: allCompanies, deals: allDeals };
  let recordsScanned = 0;

  for (const recordType of ["leads", "contacts", "companies", "deals"]) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const records = ENTITY_LISTS[recordType];
    recordsScanned += records.filter((r) => !r.previewMergedInto && !r.archived).length;
    const clusters = findCandidateClusters(recordType, records);
    const result = mergeScanResultsIntoGroups(groups, recordType, clusters);
    groups = result.groups;
    newGroupCount += result.newGroupCount;
    updatedGroupCount += result.updatedGroupCount;
  }

  const highConfidenceGroups = groups.filter((g) => g.confidenceLabel === "High" && g.reviewStatus !== "Not Duplicate").length;
  const possibleFalsePositives = groups.filter((g) => g.confidenceLabel === "Low" && !["Not Duplicate", "Preview Resolved"].includes(g.reviewStatus)).length;

  return {
    groups,
    summary: {
      recordsScanned,
      newGroupCount,
      existingGroupsRetained: existingGroups.length - updatedGroupCount,
      highConfidenceGroups,
      possibleFalsePositives,
      durationMs: Date.now() - startedAt,
      scannedAt: new Date().toISOString(),
    },
  };
});

// Applies one group's merge preview: writes the chosen field values onto
// the master via its real update thunk, marks every absorbed record as
// preview-merged (also via its real update thunk, so it goes through the
// exact same validated pathway), and records a merge-history entry that
// Undo can later replay in reverse. Never touches more than one group.
//
// `absorbedRecords` carries each absorbed record's OWN type — a mixed
// Lead-matches-Contact group can absorb a Contact into a Lead master (or
// vice versa), and each side must go through its own real update thunk
// (updateLead vs updateContact), never the master's thunk applied to a
// record of a different type.
export const applyMergePreview = createAsyncThunk(
  "crm/duplicates/applyMerge",
  async ({ groupId, masterType, masterId, absorbedRecords, finalValues, reason }, { dispatch, rejectWithValue }) => {
    const masterUpdateThunk = UPDATE_THUNKS[masterType];
    const masterBeforeRaw = FINDERS[masterType](masterId);
    if (!masterBeforeRaw) return rejectWithValue("Master record not found");
    const masterSnapshot = { ...masterBeforeRaw };
    const absorbedBefore = {};
    for (const { type, id } of absorbedRecords) {
      const r = FINDERS[type](id);
      if (r) absorbedBefore[id] = { type, snapshot: { ...r } };
    }

    const masterResult = await dispatch(masterUpdateThunk({ id: masterId, changes: finalValues }));
    if (!masterUpdateThunk.fulfilled.match(masterResult)) return rejectWithValue("Failed to update the master record");

    for (const { type, id } of absorbedRecords) {
      const thunk = UPDATE_THUNKS[type];
      await dispatch(thunk({ id, changes: { previewMergedInto: masterId, previewMergedAt: new Date().toISOString() } }));
    }

    historySeq += 1;
    const historyEntry = {
      id: `merge-live-${Date.now()}-${historySeq}`,
      groupId,
      masterType,
      masterId,
      absorbedIds: absorbedRecords.map((r) => r.id),
      masterBefore: masterSnapshot,
      absorbedBefore,
      mergedAt: new Date().toISOString(),
      mergedBy: "You",
      reason,
      undone: false,
    };
    return { groupId, historyEntry };
  }
);

export const undoMergePreview = createAsyncThunk(
  "crm/duplicates/undoMerge",
  async (historyId, { getState, dispatch, rejectWithValue }) => {
    const entry = getState().duplicates.mergeHistory.find((h) => h.id === historyId);
    if (!entry || entry.undone) return rejectWithValue("Nothing to undo");

    await dispatch(UPDATE_THUNKS[entry.masterType]({ id: entry.masterId, changes: entry.masterBefore }));
    for (const id of entry.absorbedIds) {
      const before = entry.absorbedBefore[id];
      if (before) {
        // Object.assign (the update path every record uses) only ever
        // overwrites keys present in `changes` — it never deletes a key
        // that's merely absent. The pre-merge snapshot has no
        // previewMergedInto/previewMergedAt keys at all (they didn't exist
        // yet), so restoring the snapshot alone would silently leave the
        // record marked as merged forever. Clear them explicitly.
        await dispatch(UPDATE_THUNKS[before.type]({ id, changes: { ...before.snapshot, previewMergedInto: null, previewMergedAt: null } }));
      }
    }
    return { historyId };
  }
);

const initialState = {
  groups: SEED_DUPLICATE_GROUPS,
  mergeHistory: SEED_MERGE_HISTORY,
  groupStatusBeforeMerge: {},
  scan: { status: "idle", lastScanAt: null, summary: null, error: null },
};

function findGroup(state, groupId) {
  return state.groups.find((g) => g.id === groupId);
}

const duplicatesSlice = createSlice({
  name: "duplicates",
  initialState,
  reducers: {
    markNotDuplicate: (state, action) => {
      const { groupId, reason } = action.payload;
      const g = findGroup(state, groupId);
      if (!g) return;
      g.reviewStatus = "Not Duplicate";
      g.notDuplicateReason = reason;
    },
    bulkMarkNotDuplicate: (state, action) => {
      const { groupIds, reason } = action.payload;
      for (const id of groupIds) {
        const g = findGroup(state, id);
        if (g) { g.reviewStatus = "Not Duplicate"; g.notDuplicateReason = reason; }
      }
    },
    deferReview: (state, action) => {
      const { groupId, reviewer, reviewDate, note } = action.payload;
      const g = findGroup(state, groupId);
      if (!g) return;
      g.reviewStatus = "Deferred";
      g.assignedReviewer = reviewer || g.assignedReviewer;
      g.deferredReviewDate = reviewDate || null;
      g.deferredNote = note || "";
    },
    bulkDefer: (state, action) => {
      const { groupIds, reviewer, reviewDate, note } = action.payload;
      for (const id of groupIds) {
        const g = findGroup(state, id);
        if (!g) continue;
        g.reviewStatus = "Deferred";
        g.assignedReviewer = reviewer || g.assignedReviewer;
        g.deferredReviewDate = reviewDate || null;
        g.deferredNote = note || "";
      }
    },
    assignReviewer: (state, action) => {
      const { groupId, reviewerId } = action.payload;
      const g = findGroup(state, groupId);
      if (g) g.assignedReviewer = reviewerId;
    },
    // Set when a reviewer works through the comparison workspace and reaches
    // a valid merge preview (a master chosen, required conflicts resolved) —
    // "I've confirmed this is a duplicate" without yet applying the merge.
    confirmDuplicate: (state, action) => {
      const { groupId } = action.payload;
      const g = findGroup(state, groupId);
      if (g) g.reviewStatus = "Confirmed Duplicate";
    },
    bulkAssignReviewer: (state, action) => {
      const { groupIds, reviewerId } = action.payload;
      for (const id of groupIds) {
        const g = findGroup(state, id);
        if (g) g.assignedReviewer = reviewerId;
      }
    },
    bulkMarkForReview: (state, action) => {
      const { groupIds } = action.payload;
      for (const id of groupIds) {
        const g = findGroup(state, id);
        if (g && !["Not Duplicate", "Preview Resolved"].includes(g.reviewStatus)) g.reviewStatus = "Needs Review";
      }
    },
    setReviewNotes: (state, action) => {
      const { groupId, notes } = action.payload;
      const g = findGroup(state, groupId);
      if (g) g.reviewNotes = notes;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(runFrontendScan.pending, (state) => {
        state.scan.status = "running";
        state.scan.error = null;
      })
      .addCase(runFrontendScan.fulfilled, (state, action) => {
        state.scan.status = "done";
        state.scan.summary = action.payload.summary;
        state.scan.lastScanAt = action.payload.summary.scannedAt;
        state.groups = action.payload.groups;
      })
      .addCase(runFrontendScan.rejected, (state, action) => {
        state.scan.status = "error";
        state.scan.error = action.error?.message || "The frontend scan failed unexpectedly.";
      })
      .addCase(applyMergePreview.fulfilled, (state, action) => {
        const { groupId, historyEntry } = action.payload;
        const g = findGroup(state, groupId);
        if (g) {
          state.groupStatusBeforeMerge[historyEntry.id] = g.reviewStatus;
          g.reviewStatus = "Preview Resolved";
        }
        state.mergeHistory.unshift(historyEntry);
      })
      .addCase(applyMergePreview.rejected, (state, action) => {
        toast.error(action.payload || "Failed to apply the frontend merge preview");
      })
      .addCase(undoMergePreview.fulfilled, (state, action) => {
        const entry = state.mergeHistory.find((h) => h.id === action.payload.historyId);
        if (!entry) return;
        entry.undone = true;
        const g = findGroup(state, entry.groupId);
        if (g) g.reviewStatus = state.groupStatusBeforeMerge[entry.id] || "Needs Review";
        toast.success("Merge undone for this session");
      })
      .addCase(undoMergePreview.rejected, (state, action) => {
        toast.error(action.payload || "Nothing to undo");
      });
  },
});

export const REVIEW_STATUSES = ["New", "Needs Review", "Confirmed Duplicate", "Not Duplicate", "Deferred", "Preview Resolved"];

export const {
  markNotDuplicate, bulkMarkNotDuplicate, deferReview, bulkDefer,
  assignReviewer, bulkAssignReviewer, bulkMarkForReview, setReviewNotes, confirmDuplicate,
} = duplicatesSlice.actions;
export default duplicatesSlice.reducer;
