import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";

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

// Deliberately unpaginated at the Redux layer (like Companies) — Agenda and
// Calendar views need visibility across the whole filtered set, not just
// one page; the Table view paginates client-side over this same array via
// queryActivitiesLocal.
export const fetchActivities = createAsyncThunk("crm/activities/fetchAll", async (params = {}, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/crm/activities", { params });
    return data.activities;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load activities");
  }
});

export const fetchActivity = createAsyncThunk("crm/activities/fetchOne", async (id, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get(`/crm/activities/${id}`);
    return data.activity;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load activity");
  }
});

export const createActivity = createAsyncThunk("crm/activities/create", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/crm/activities", payload);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to create activity" });
  }
});

export const updateActivity = createAsyncThunk("crm/activities/update", async ({ id, changes }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.put(`/crm/activities/${id}`, changes);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to update activity" });
  }
});

export const completeActivity = createAsyncThunk("crm/activities/complete", async ({ id, outcome, completionNote, followUp }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/activities/${id}/complete`, { outcome, completionNote, followUp });
    toast.promise(res, { loading: "Completing...", success: "Activity completed in preview", error: "Failed to complete activity" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to complete activity");
  }
});

export const createFollowUpActivity = createAsyncThunk("crm/activities/createFollowUp", async ({ id, title, dueDate, ownerId }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/activities/${id}/followup`, { title, dueDate, ownerId });
    toast.promise(res, { loading: "Creating follow-up...", success: "Follow-up created in preview", error: "Failed to create follow-up" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to create follow-up");
  }
});

export const rescheduleActivity = createAsyncThunk("crm/activities/reschedule", async ({ id, startAt, endAt, timezone, reminder, reason }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/activities/${id}/reschedule`, { startAt, endAt, timezone, reminder, reason });
    toast.promise(res, { loading: "Rescheduling...", success: "Rescheduled in preview", error: "Failed to reschedule" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to reschedule activity");
  }
});

export const cancelActivity = createAsyncThunk("crm/activities/cancel", async ({ id, reason }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/activities/${id}/cancel`, { reason });
    toast.promise(res, { loading: "Cancelling...", success: "Activity cancelled in preview", error: "Failed to cancel activity" });
    const { data } = await res;
    return data.activity;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to cancel activity");
  }
});

export const reopenActivity = createAsyncThunk("crm/activities/reopen", async (id, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/activities/${id}/reopen`);
    toast.promise(res, { loading: "Reopening...", success: "Activity reopened in preview", error: "Failed to reopen activity" });
    const { data } = await res;
    return data.activity;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to reopen activity");
  }
});

export const duplicateActivity = createAsyncThunk("crm/activities/duplicate", async (id, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/activities/${id}/duplicate`);
    toast.promise(res, { loading: "Duplicating...", success: "Activity duplicated in preview", error: "Failed to duplicate activity" });
    const { data } = await res;
    return data.activity;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to duplicate activity");
  }
});

export const uploadActivityAttachment = createAsyncThunk("crm/activities/uploadAttachment", async ({ id, file }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/activities/${id}/attachments`, file);
    toast.promise(res, { loading: "Uploading...", success: "Attachment added to preview", error: "Failed to upload attachment" });
    const { data } = await res;
    return data.activity;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to upload attachment");
  }
});

export const fetchActivityConflicts = createAsyncThunk("crm/activities/fetchConflicts", async (id, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get(`/crm/activities/${id}/conflicts`);
    return data.conflicts;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to check conflicts");
  }
});

export const bulkAssignActivities = createAsyncThunk("crm/activities/bulkAssign", async ({ activityIds, ownerId }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/crm/activities/bulk/assign", { activityIds, ownerId });
    toast.success(`${data.activities.length} activit${data.activities.length === 1 ? "y" : "ies"} reassigned in preview`);
    return data.activities;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk assign");
  }
});

export const bulkRescheduleActivities = createAsyncThunk("crm/activities/bulkReschedule", async ({ activityIds, startAt }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/crm/activities/bulk/reschedule", { activityIds, startAt });
    toast.success(`${data.activities.length} activit${data.activities.length === 1 ? "y" : "ies"} rescheduled in preview`);
    return data.activities;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk reschedule");
  }
});

export const bulkCompleteActivities = createAsyncThunk("crm/activities/bulkComplete", async ({ activityIds }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/crm/activities/bulk/complete", { activityIds });
    toast.success(`${data.activities.length} activit${data.activities.length === 1 ? "y" : "ies"} completed in preview`);
    return data.activities;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk complete");
  }
});

export const bulkCancelActivities = createAsyncThunk("crm/activities/bulkCancel", async ({ activityIds, reason }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/crm/activities/bulk/cancel", { activityIds, reason });
    toast.success(`${data.activities.length} activit${data.activities.length === 1 ? "y" : "ies"} cancelled in preview`);
    return data.activities;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk cancel");
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
