import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";
import * as backendActivities from "../../Helpers/crmActivitiesBackend";
import { notSupported } from "../../Helpers/crmBackendCommon";

// Re-exported from the mock data layer — the single source of truth.
export {
  ACTIVITY_TYPES,
  ACTIVITY_STATUSES,
  ACTIVITY_PRIORITIES,
  RELATED_RECORD_TYPES,
  CALL_DIRECTIONS,
  EMAIL_DIRECTIONS,
  NOTE_VISIBILITIES,
  CALL_OUTCOMES,
  MEETING_OUTCOMES,
  effectiveStatus,
  isDoNotContact,
  doNotContactReason,
} from "../../Helpers/mockActivitiesData";

// VITE_BACKEND_CRM_SALES_MODE=true reads/writes activities through the real
// /crm/activities API (crmActivitiesBackend.js translates shapes); otherwise
// the mock layer. Attachments report "not available yet" in backend mode.
const BACKEND = backendActivities.BACKEND_ENABLED;
const errorMessage = (error, fallback) => error.response?.data?.message || (BACKEND ? error.message : null) || fallback;
const errorBody = (error, fallback) => error.response?.data || { message: (BACKEND && error.message) || fallback };
const where = BACKEND ? "" : " in preview";
const activities = (n) => `activit${n === 1 ? "y" : "ies"}`;
const loaded = (getState) => getState().activities?.items || [];

// Deliberately unpaginated at the Redux layer (like Companies) — Agenda and
// Calendar views need visibility across the whole filtered set, not just
// one page; the Table view paginates client-side over this same array via
// queryActivitiesLocal.
export const fetchActivities = createAsyncThunk("crm/activities/fetchAll", async (params = {}, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendActivities.listActivities();
    const { data } = await axiosInstance.get("/crm/activities", { params });
    return data.activities;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to load activities"));
  }
});

export const fetchActivity = createAsyncThunk("crm/activities/fetchOne", async (id, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendActivities.getActivity(id);
    const { data } = await axiosInstance.get(`/crm/activities/${id}`);
    return data.activity;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to load activity"));
  }
});

export const createActivity = createAsyncThunk("crm/activities/create", async (payload, { rejectWithValue, getState }) => {
  try {
    if (BACKEND) return await backendActivities.createActivity(payload, loaded(getState));
    const { data } = await axiosInstance.post("/crm/activities", payload);
    return data;
  } catch (error) {
    return rejectWithValue(errorBody(error, "Failed to create activity"));
  }
});

export const updateActivity = createAsyncThunk("crm/activities/update", async ({ id, changes }, { rejectWithValue, getState }) => {
  try {
    if (BACKEND) return await backendActivities.updateActivity(id, changes, loaded(getState));
    const { data } = await axiosInstance.put(`/crm/activities/${id}`, changes);
    return data;
  } catch (error) {
    return rejectWithValue(errorBody(error, "Failed to update activity"));
  }
});

export const completeActivity = createAsyncThunk("crm/activities/complete", async ({ id, outcome, completionNote, followUp }, { rejectWithValue }) => {
  try {
    const res = BACKEND
      ? backendActivities.completeActivity(id, { outcome, completionNote, followUp }).then((data) => ({ data }))
      : axiosInstance.post(`/crm/activities/${id}/complete`, { outcome, completionNote, followUp });
    toast.promise(res, { loading: "Completing...", success: `Activity completed${where}`, error: "Failed to complete activity" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to complete activity"));
  }
});

export const createFollowUpActivity = createAsyncThunk("crm/activities/createFollowUp", async ({ id, title, dueDate, ownerId }, { rejectWithValue }) => {
  try {
    const res = BACKEND
      ? backendActivities.createFollowUp(id, { title, dueDate, ownerId }).then((data) => ({ data }))
      : axiosInstance.post(`/crm/activities/${id}/followup`, { title, dueDate, ownerId });
    toast.promise(res, { loading: "Creating follow-up...", success: `Follow-up created${where}`, error: "Failed to create follow-up" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to create follow-up"));
  }
});

export const rescheduleActivity = createAsyncThunk("crm/activities/reschedule", async ({ id, startAt, endAt, timezone, reminder, reason }, { rejectWithValue, getState }) => {
  try {
    const res = BACKEND
      ? backendActivities.rescheduleActivity(id, { startAt, endAt, timezone, reminder }, loaded(getState)).then((data) => ({ data }))
      : axiosInstance.post(`/crm/activities/${id}/reschedule`, { startAt, endAt, timezone, reminder, reason });
    toast.promise(res, { loading: "Rescheduling...", success: `Rescheduled${where}`, error: "Failed to reschedule" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to reschedule activity"));
  }
});

export const cancelActivity = createAsyncThunk("crm/activities/cancel", async ({ id, reason }, { rejectWithValue }) => {
  try {
    const res = BACKEND
      ? backendActivities.cancelActivity(id, reason).then((activity) => ({ data: { activity } }))
      : axiosInstance.post(`/crm/activities/${id}/cancel`, { reason });
    toast.promise(res, { loading: "Cancelling...", success: `Activity cancelled${where}`, error: "Failed to cancel activity" });
    const { data } = await res;
    return data.activity;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to cancel activity"));
  }
});

export const reopenActivity = createAsyncThunk("crm/activities/reopen", async (id, { rejectWithValue }) => {
  try {
    const res = BACKEND
      ? backendActivities.reopenActivity(id).then((activity) => ({ data: { activity } }))
      : axiosInstance.post(`/crm/activities/${id}/reopen`);
    toast.promise(res, { loading: "Reopening...", success: `Activity reopened${where}`, error: "Failed to reopen activity" });
    const { data } = await res;
    return data.activity;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to reopen activity"));
  }
});

export const duplicateActivity = createAsyncThunk("crm/activities/duplicate", async (id, { rejectWithValue }) => {
  try {
    const res = BACKEND
      ? backendActivities.duplicateActivity(id).then((activity) => ({ data: { activity } }))
      : axiosInstance.post(`/crm/activities/${id}/duplicate`);
    toast.promise(res, { loading: "Duplicating...", success: `Activity duplicated${where}`, error: "Failed to duplicate activity" });
    const { data } = await res;
    return data.activity;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to duplicate activity"));
  }
});

export const uploadActivityAttachment = createAsyncThunk("crm/activities/uploadAttachment", async ({ id, file }, { rejectWithValue }) => {
  try {
    const res = BACKEND ? Promise.reject(notSupported("Attachments")) : axiosInstance.post(`/crm/activities/${id}/attachments`, file);
    toast.promise(res, { loading: "Uploading...", success: "Attachment added to preview", error: (err) => errorMessage(err, "Failed to upload attachment") });
    const { data } = await res;
    return data.activity;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to upload attachment"));
  }
});

export const fetchActivityConflicts = createAsyncThunk("crm/activities/fetchConflicts", async (id, { rejectWithValue, getState }) => {
  try {
    if (BACKEND) {
      const items = loaded(getState);
      const activity = items.find((a) => a._id === id) || getState().activities?.current;
      return activity ? backendActivities.conflictsFor(activity, items) : [];
    }
    const { data } = await axiosInstance.get(`/crm/activities/${id}/conflicts`);
    return data.conflicts;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to check conflicts"));
  }
});

export const bulkAssignActivities = createAsyncThunk("crm/activities/bulkAssign", async ({ activityIds, ownerId }, { rejectWithValue }) => {
  try {
    const list = BACKEND
      ? await backendActivities.bulkAssignActivities(activityIds, ownerId)
      : (await axiosInstance.post("/crm/activities/bulk/assign", { activityIds, ownerId })).data.activities;
    toast.success(`${list.length} ${activities(list.length)} reassigned${where}`);
    return list;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to bulk assign"));
  }
});

export const bulkRescheduleActivities = createAsyncThunk("crm/activities/bulkReschedule", async ({ activityIds, startAt }, { rejectWithValue }) => {
  try {
    const list = BACKEND
      ? await backendActivities.bulkRescheduleActivities(activityIds, startAt)
      : (await axiosInstance.post("/crm/activities/bulk/reschedule", { activityIds, startAt })).data.activities;
    toast.success(`${list.length} ${activities(list.length)} rescheduled${where}`);
    return list;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to bulk reschedule"));
  }
});

export const bulkCompleteActivities = createAsyncThunk("crm/activities/bulkComplete", async ({ activityIds }, { rejectWithValue }) => {
  try {
    const list = BACKEND
      ? await backendActivities.bulkCompleteActivities(activityIds)
      : (await axiosInstance.post("/crm/activities/bulk/complete", { activityIds })).data.activities;
    toast.success(`${list.length} ${activities(list.length)} completed${where}`);
    return list;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to bulk complete"));
  }
});

export const bulkCancelActivities = createAsyncThunk("crm/activities/bulkCancel", async ({ activityIds, reason }, { rejectWithValue }) => {
  try {
    const list = BACKEND
      ? await backendActivities.bulkCancelActivities(activityIds, reason)
      : (await axiosInstance.post("/crm/activities/bulk/cancel", { activityIds, reason })).data.activities;
    toast.success(`${list.length} ${activities(list.length)} cancelled${where}`);
    return list;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to bulk cancel"));
  }
});

const initialState = {
  items: [], current: null, currentNotFound: false, loading: false, error: null,
  conflicts: [], lastCreatedConflicts: [],
};

const applyOne = (state, action) => {
  const updated = action.payload;
  if (!updated) return;
  state.items = state.items.map((a) => (a._id === updated._id ? updated : a));
  if (state.current?._id === updated._id) state.current = updated;
};
const applyMany = (state, action) => {
  const updated = action.payload || [];
  const byId = new Map(updated.map((a) => [a._id, a]));
  state.items = state.items.map((a) => byId.get(a._id) || a);
  if (state.current && byId.has(state.current._id)) state.current = byId.get(state.current._id);
};
const applyEnvelope = (state, action) => {
  const { activity, followUp } = action.payload || {};
  if (!activity) return;
  state.items = state.items.map((a) => (a._id === activity._id ? activity : a));
  if (state.current?._id === activity._id) state.current = activity;
  if (followUp) state.items.unshift(followUp);
};

const activitiesSlice = createSlice({
  name: "activities",
  initialState,
  reducers: {
    clearActivityConflicts: (state) => {
      state.lastCreatedConflicts = [];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchActivities.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchActivities.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload || [];
      })
      .addCase(fetchActivities.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchActivity.pending, (state) => {
        state.current = null;
        state.currentNotFound = false;
      })
      .addCase(fetchActivity.fulfilled, (state, action) => {
        state.current = action.payload;
        state.currentNotFound = false;
      })
      .addCase(fetchActivity.rejected, (state) => {
        state.current = null;
        state.currentNotFound = true;
      })
      .addCase(createActivity.fulfilled, (state, action) => {
        const { activity, conflicts } = action.payload || {};
        if (activity) state.items.unshift(activity);
        state.lastCreatedConflicts = conflicts || [];
      })
      .addCase(updateActivity.fulfilled, (state, action) => {
        const { activity } = action.payload || {};
        if (!activity) return;
        state.items = state.items.map((a) => (a._id === activity._id ? activity : a));
        if (state.current?._id === activity._id) state.current = activity;
      })
      .addCase(completeActivity.fulfilled, applyEnvelope)
      .addCase(createFollowUpActivity.fulfilled, applyEnvelope)
      .addCase(rescheduleActivity.fulfilled, (state, action) => {
        const { activity } = action.payload || {};
        if (!activity) return;
        state.items = state.items.map((a) => (a._id === activity._id ? activity : a));
        if (state.current?._id === activity._id) state.current = activity;
      })
      .addCase(cancelActivity.fulfilled, applyOne)
      .addCase(reopenActivity.fulfilled, applyOne)
      .addCase(duplicateActivity.fulfilled, (state, action) => {
        if (action.payload) state.items.unshift(action.payload);
      })
      .addCase(uploadActivityAttachment.fulfilled, applyOne)
      .addCase(fetchActivityConflicts.fulfilled, (state, action) => {
        state.conflicts = action.payload || [];
      })
      .addCase(bulkAssignActivities.fulfilled, applyMany)
      .addCase(bulkRescheduleActivities.fulfilled, applyMany)
      .addCase(bulkCompleteActivities.fulfilled, applyMany)
      .addCase(bulkCancelActivities.fulfilled, applyMany);
  },
});

export const { clearActivityConflicts } = activitiesSlice.actions;
export default activitiesSlice.reducer;
