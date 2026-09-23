import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";
import * as backendLeads from "../../Helpers/crmLeadsBackend";

// VITE_BACKEND_CRM_MODE=true reads/writes leads through the real /crm/leads
// API (crmLeadsBackend.js translates shapes); otherwise the mock layer.
// Actions the real API doesn't support yet reject with a clear message
// instead of silently falling back to mock data.
const BACKEND = backendLeads.BACKEND_CRM_MODE_ENABLED;
const errorMessage = (error, fallback) => error.response?.data?.message || (BACKEND ? error.message : null) || fallback;
const errorBody = (error, fallback) => error.response?.data || { message: (BACKEND && error.message) || fallback };

export const LEAD_STATUSES = [
  "New",
  "Attempted",
  "Contacted",
  "Qualified",
  "Converted",
  "Unqualified",
  "Duplicate",
  "Spam",
];

export const REASON_REQUIRED_STATUSES = ["Unqualified", "Duplicate", "Spam"];

// fetchLeads takes the full filter/sort/page param set and returns exactly
// one page — the store never holds more leads than are currently displayed.
export const fetchLeads = createAsyncThunk("crm/leads/fetchAll", async (params = {}, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendLeads.listLeads(params);
    const { data } = await axiosInstance.get("/crm/leads", { params });
    return data; // { leads, total, page, pageSize, summary }
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to load leads"));
  }
});

// Fetches every lead matching the given filters, ignoring pagination — used
// for "export filtered results" so the export isn't limited to one page.
export const fetchAllMatchingLeads = createAsyncThunk(
  "crm/leads/fetchAllMatching",
  async (params = {}, { rejectWithValue }) => {
    try {
      if (BACKEND) return await backendLeads.listAllMatchingLeads(params);
      const { data } = await axiosInstance.get("/crm/leads", { params: { ...params, page: 1, pageSize: 100000 } });
      return data.leads;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to export leads"));
    }
  }
);

export const fetchLead = createAsyncThunk("crm/leads/fetchOne", async (id, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendLeads.getLead(id);
    const { data } = await axiosInstance.get(`/crm/leads/${id}`);
    return data.lead;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to load lead"));
  }
});

export const fetchLeadAudit = createAsyncThunk("crm/leads/fetchAudit", async (id, { rejectWithValue }) => {
  try {
    // The backend records audit events per organization, not per lead yet.
    if (BACKEND) return [];
    const { data } = await axiosInstance.get(`/crm/leads/${id}/audit`);
    return data.auditLog;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to load audit history"));
  }
});

export const createLead = createAsyncThunk("crm/leads/create", async (leadData, { rejectWithValue }) => {
  try {
    const res = BACKEND ? backendLeads.createLead(leadData).then((lead) => ({ data: { lead } })) : axiosInstance.post("/crm/leads", leadData);
    toast.promise(res, { loading: "Creating lead...", success: "Lead created", error: "Failed to create lead" });
    const { data } = await res;
    return data.lead;
  } catch (error) {
    return rejectWithValue(errorBody(error, "Failed to create lead"));
  }
});

export const updateLead = createAsyncThunk("crm/leads/update", async ({ id, changes }, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendLeads.updateLead(id, changes);
    const { data } = await axiosInstance.put(`/crm/leads/${id}`, changes);
    return data.lead;
  } catch (error) {
    return rejectWithValue(errorBody(error, "Failed to update lead"));
  }
});

export const assignLead = createAsyncThunk("crm/leads/assign", async ({ id, ownerId }, { rejectWithValue }) => {
  try {
    const res = BACKEND ? backendLeads.assignLead(id, ownerId).then((lead) => ({ data: { lead } })) : axiosInstance.put(`/crm/leads/${id}`, { ownerId });
    toast.promise(res, { loading: "Assigning...", success: "Lead reassigned", error: "Failed to reassign lead" });
    const { data } = await res;
    return data.lead;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to reassign lead"));
  }
});

export const disqualifyLead = createAsyncThunk(
  "crm/leads/disqualify",
  async ({ id, reason, status = "Unqualified" }, { rejectWithValue }) => {
    if (!reason?.trim()) return rejectWithValue("A reason is required to disqualify a lead");
    try {
      const lead = BACKEND
        ? await backendLeads.updateLead(id, { status, disqualifyReason: reason })
        : (await axiosInstance.put(`/crm/leads/${id}`, { status, disqualifyReason: reason })).data.lead;
      toast.success(`Lead marked as ${status}`);
      return lead;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to disqualify lead"));
    }
  }
);

export const addLeadNote = createAsyncThunk("crm/leads/addNote", async ({ id, message }, { rejectWithValue }) => {
  if (!message?.trim()) return rejectWithValue("Note cannot be empty");
  try {
    if (BACKEND) return await backendLeads.addLeadNote(id, message);
    const { data } = await axiosInstance.post(`/crm/leads/${id}/notes`, { message });
    return data.lead;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to add note"));
  }
});

export const logLeadActivity = createAsyncThunk(
  "crm/leads/logActivity",
  async ({ id, type, description }, { rejectWithValue }) => {
    try {
      // Stored as a note on the lead, labelled with the activity type, until
      // the Activities page is on the backend too (a later step).
      const res = BACKEND
        ? backendLeads.addLeadNote(id, `[${type || "note"}] ${description}`).then((lead) => ({ data: { lead } }))
        : axiosInstance.post(`/crm/leads/${id}/activity`, { type, description });
      toast.promise(res, { loading: "Logging activity...", success: "Activity logged", error: "Failed to log activity" });
      const { data } = await res;
      return data.lead;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to log activity"));
    }
  }
);

export const createLeadTask = createAsyncThunk("crm/leads/createTask", async ({ id, task }, { rejectWithValue }) => {
  try {
    const res = BACKEND ? Promise.reject(backendLeads.notSupported("Follow-up tasks")) : axiosInstance.post(`/crm/leads/${id}/tasks`, task);
    toast.promise(res, { loading: "Scheduling...", success: "Follow-up scheduled", error: (err) => errorMessage(err, "Failed to schedule follow-up") });
    const { data } = await res;
    return data.lead;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to schedule follow-up"));
  }
});

export const updateLeadTask = createAsyncThunk(
  "crm/leads/updateTask",
  async ({ id, taskId, changes }, { rejectWithValue }) => {
    try {
      if (BACKEND) throw backendLeads.notSupported("Follow-up tasks");
      const { data } = await axiosInstance.put(`/crm/leads/${id}/tasks/${taskId}`, changes);
      return data.lead;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to update task"));
    }
  }
);

export const uploadLeadFile = createAsyncThunk("crm/leads/uploadFile", async ({ id, file }, { rejectWithValue }) => {
  try {
    const res = BACKEND ? Promise.reject(backendLeads.notSupported("File uploads")) : axiosInstance.post(`/crm/leads/${id}/files`, file);
    toast.promise(res, { loading: "Uploading...", success: "File uploaded", error: (err) => errorMessage(err, "Failed to upload file") });
    const { data } = await res;
    return data.lead;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to upload file"));
  }
});

export const deleteLeadFile = createAsyncThunk("crm/leads/deleteFile", async ({ id, fileId }, { rejectWithValue }) => {
  try {
    if (BACKEND) throw backendLeads.notSupported("File uploads");
    const { data } = await axiosInstance.delete(`/crm/leads/${id}/files/${fileId}`);
    return data.lead;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to delete file"));
  }
});

export const archiveLead = createAsyncThunk("crm/leads/archive", async ({ id, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to archive a lead");
  try {
    const res = BACKEND ? backendLeads.archiveLead(id, reason).then((lead) => ({ data: { lead } })) : axiosInstance.post(`/crm/leads/${id}/archive`, { reason });
    toast.promise(res, { loading: "Archiving...", success: "Lead archived", error: "Failed to archive lead" });
    const { data } = await res;
    return data.lead;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to archive lead"));
  }
});

export const restoreLead = createAsyncThunk("crm/leads/restore", async (id, { rejectWithValue }) => {
  try {
    const res = BACKEND ? backendLeads.restoreLead(id).then((lead) => ({ data: { lead } })) : axiosInstance.post(`/crm/leads/${id}/restore`);
    toast.promise(res, { loading: "Restoring...", success: "Lead restored", error: "Failed to restore lead" });
    const { data } = await res;
    return data.lead;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to restore lead"));
  }
});

export const reopenLead = createAsyncThunk("crm/leads/reopen", async ({ id, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to reopen a converted lead");
  try {
    const res = BACKEND ? Promise.reject(backendLeads.notSupported("Reopening a converted lead")) : axiosInstance.post(`/crm/leads/${id}/reopen`, { reason });
    toast.promise(res, { loading: "Reopening...", success: "Lead reopened", error: (err) => errorMessage(err, "Failed to reopen lead") });
    const { data } = await res;
    return data.lead;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to reopen lead"));
  }
});

export const convertLead = createAsyncThunk("crm/leads/convert", async (id, { rejectWithValue }) => {
  try {
    const res = BACKEND ? backendLeads.convertLead(id).then((data) => ({ data })) : axiosInstance.post(`/crm/leads/${id}/convert`);
    toast.promise(res, {
      loading: "Converting lead...",
      success: BACKEND ? "Lead converted — company and contact created" : "Lead converted — company, contact and deal created",
      error: (err) => err.response?.data?.message || "Failed to convert lead",
    });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to convert lead"));
  }
});

export const bulkAssignLeads = createAsyncThunk(
  "crm/leads/bulkAssign",
  async ({ leadIds, ownerId }, { rejectWithValue }) => {
    try {
      const res = BACKEND
        ? backendLeads.bulkAssignLeads(leadIds, ownerId).then((leads) => ({ data: { leads } }))
        : axiosInstance.post("/crm/leads/bulk/assign", { leadIds, ownerId });
      toast.promise(res, { loading: "Assigning...", success: `${leadIds.length} leads reassigned`, error: "Bulk assignment failed" });
      const { data } = await res;
      return data.leads;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Bulk assignment failed"));
    }
  }
);

export const bulkStatusChangeLeads = createAsyncThunk(
  "crm/leads/bulkStatus",
  async ({ leadIds, status, reason }, { rejectWithValue }) => {
    try {
      const res = BACKEND
        ? backendLeads.bulkStatusLeads(leadIds, status, reason).then((leads) => ({ data: { leads } }))
        : axiosInstance.post("/crm/leads/bulk/status", { leadIds, status, reason });
      toast.promise(res, { loading: "Updating...", success: `${leadIds.length} leads updated`, error: "Bulk status change failed" });
      const { data } = await res;
      return data.leads;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Bulk status change failed"));
    }
  }
);

export const bulkArchiveLeads = createAsyncThunk(
  "crm/leads/bulkArchive",
  async ({ leadIds, reason }, { rejectWithValue }) => {
    if (!reason?.trim()) return rejectWithValue("A reason is required to archive leads");
    try {
      const res = BACKEND
        ? backendLeads.bulkArchiveLeads(leadIds, reason).then((leads) => ({ data: { leads } }))
        : axiosInstance.post("/crm/leads/bulk/archive", { leadIds, reason });
      toast.promise(res, { loading: "Archiving...", success: `${leadIds.length} leads archived`, error: "Bulk archive failed" });
      const { data } = await res;
      return data.leads;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Bulk archive failed"));
    }
  }
);

const initialState = {
  items: [],
  current: null,
  currentNotFound: false,
  currentAudit: [],
  total: 0,
  page: 1,
  pageSize: 20,
  summary: { total: 0, open: 0, new: 0, qualified: 0, followUpsDue: 0, overdueFollowUps: 0, conversionRate: 0 },
  loading: false,
  error: null,
  duplicates: [],
};

const applyOne = (state, action) => {
  const updated = action.payload;
  if (!updated) return;
  state.items = state.items.map((l) => (l._id === updated._id ? updated : l));
  if (state.current?._id === updated._id) state.current = updated;
};

const applyMany = (state, action) => {
  const updatedList = action.payload;
  if (!updatedList) return;
  const byId = new Map(updatedList.map((l) => [l._id, l]));
  state.items = state.items.map((l) => byId.get(l._id) || l);
};

const leadsSlice = createSlice({
  name: "leads",
  initialState,
  reducers: {
    clearLeadDuplicates: (state) => {
      state.duplicates = [];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchLeads.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchLeads.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload.leads || [];
        state.total = action.payload.total || 0;
        state.page = action.payload.page || 1;
        state.pageSize = action.payload.pageSize || 20;
        state.summary = action.payload.summary || initialState.summary;
      })
      .addCase(fetchLeads.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchLead.pending, (state) => {
        state.current = null;
        state.currentNotFound = false;
      })
      .addCase(fetchLead.fulfilled, (state, action) => {
        state.current = action.payload;
        state.currentNotFound = false;
      })
      .addCase(fetchLead.rejected, (state) => {
        // Mock data lives only in memory, so a lead created earlier this
        // session genuinely stops existing after a full page reload — this
        // must read as "not found", not spin on "Loading lead..." forever.
        state.current = null;
        state.currentNotFound = true;
      })
      .addCase(fetchLeadAudit.fulfilled, (state, action) => {
        state.currentAudit = action.payload || [];
      })
      .addCase(createLead.rejected, (state, action) => {
        state.duplicates = action.payload?.duplicates || [];
      })
      .addCase(createLead.fulfilled, (state, action) => {
        if (action.payload) {
          state.items.unshift(action.payload);
          state.total += 1;
        }
        state.duplicates = [];
      })
      .addCase(disqualifyLead.rejected, (state, action) => {
        toast.error(action.payload || "Failed to disqualify lead");
      })
      .addCase(bulkAssignLeads.fulfilled, applyMany)
      .addCase(bulkStatusChangeLeads.fulfilled, applyMany)
      .addCase(bulkArchiveLeads.fulfilled, applyMany);

    [
      updateLead,
      assignLead,
      disqualifyLead,
      archiveLead,
      restoreLead,
      reopenLead,
      addLeadNote,
      logLeadActivity,
      createLeadTask,
      updateLeadTask,
      uploadLeadFile,
      deleteLeadFile,
    ].forEach((thunk) => builder.addCase(thunk.fulfilled, applyOne));

    builder.addCase(convertLead.fulfilled, (state, action) => {
      const { lead } = action.payload || {};
      if (!lead) return;
      state.items = state.items.map((l) => (l._id === lead._id ? lead : l));
      if (state.current?._id === lead._id) state.current = lead;
    });
  },
});

export const { clearLeadDuplicates } = leadsSlice.actions;
export default leadsSlice.reducer;
