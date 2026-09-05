import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";

// Re-exported from mockCrmData — the single source of truth for these lists.
export {
  COMPANY_ACCOUNT_TYPES,
  COMPANY_LIFECYCLE_STAGES,
  COMPANY_CUSTOMER_STATUSES,
  COMPANY_ACCOUNT_TIERS,
  COMPANY_ACCOUNT_HEALTH,
  COMPANY_SIZES,
  COMPANY_SOURCES,
  COMPANY_REGIONS,
  COMPANY_TEAMS,
  COMPANY_REASON_REQUIRED_LIFECYCLE,
} from "../../Helpers/mockCrmData";

// Deliberately NOT server-shaped/paginated, unlike Leads/Contacts: several
// unrelated pages (Support, Finance, Projects, Marketing Segments, the CRM
// dashboard) already consume the full company list via this same thunk.
// Companies list filtering/sorting/paging happens client-side in
// CompaniesList.jsx over this full array, using the shared
// queryCompaniesLocal() utility — still centralized, just not server-shaped.
export const fetchCompanies = createAsyncThunk("crm/companies/fetchAll", async (_, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/crm/companies");
    return data.companies;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load companies");
  }
});

export const fetchCompany = createAsyncThunk("crm/companies/fetchOne", async (id, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get(`/crm/companies/${id}`);
    return data.company;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load company");
  }
});

export const createCompany = createAsyncThunk("crm/companies/create", async (companyData, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/crm/companies", companyData);
    return data.company;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to create company" });
  }
});

export const updateCompany = createAsyncThunk("crm/companies/update", async ({ id, changes }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.put(`/crm/companies/${id}`, changes);
    return data.company;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to update company" });
  }
});

export const assignCompanyOwner = createAsyncThunk("crm/companies/assignOwner", async ({ id, ownerId }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.put(`/crm/companies/${id}`, { ownerId });
    toast.promise(res, { loading: "Assigning...", success: "Owner updated in preview", error: "Failed to reassign company" });
    const { data } = await res;
    return data.company;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to reassign company");
  }
});

export const changeCompanyLifecycle = createAsyncThunk("crm/companies/changeLifecycle", async ({ id, lifecycleStage, reason }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.put(`/crm/companies/${id}`, { lifecycleStage, lifecycleChangeReason: reason });
    toast.promise(res, { loading: "Updating lifecycle...", success: "Lifecycle updated in preview", error: "Failed to update lifecycle" });
    const { data } = await res;
    return data.company;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to update lifecycle");
  }
});

export const changeCompanyHealth = createAsyncThunk("crm/companies/changeHealth", async ({ id, accountHealth, healthReason }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.put(`/crm/companies/${id}`, { accountHealth, healthReason });
    toast.promise(res, { loading: "Updating health...", success: "Account health updated in preview", error: "Failed to update account health" });
    const { data } = await res;
    return data.company;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to update account health");
  }
});

export const addCompanyNote = createAsyncThunk("crm/companies/addNote", async ({ id, message }, { rejectWithValue }) => {
  if (!message?.trim()) return rejectWithValue("Note cannot be empty");
  try {
    const { data } = await axiosInstance.post(`/crm/companies/${id}/notes`, { message });
    return data.company;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to add note");
  }
});

export const logCompanyActivity = createAsyncThunk(
  "crm/companies/logActivity",
  async ({ id, type, description }, { rejectWithValue }) => {
    try {
      const res = axiosInstance.post(`/crm/companies/${id}/activity`, { type, description });
      toast.promise(res, { loading: "Logging activity...", success: "Activity logged", error: "Failed to log activity" });
      const { data } = await res;
      return data.company;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to log activity");
    }
  }
);

export const createCompanyTask = createAsyncThunk("crm/companies/createTask", async ({ id, task }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/companies/${id}/tasks`, task);
    toast.promise(res, { loading: "Adding task...", success: "Task added", error: "Failed to add task" });
    const { data } = await res;
    return data.company;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to add task");
  }
});

export const updateCompanyTask = createAsyncThunk("crm/companies/updateTask", async ({ id, taskId, changes }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.put(`/crm/companies/${id}/tasks/${taskId}`, changes);
    return data.company;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to update task");
  }
});

export const uploadCompanyFile = createAsyncThunk("crm/companies/uploadFile", async ({ id, file }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/companies/${id}/files`, file);
    toast.promise(res, { loading: "Uploading...", success: "File added to preview", error: "Failed to upload file" });
    const { data } = await res;
    return data.company;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to upload file");
  }
});

export const deleteCompanyFile = createAsyncThunk("crm/companies/deleteFile", async ({ id, fileId }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.delete(`/crm/companies/${id}/files/${fileId}`);
    return data.company;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to remove file");
  }
});

export const archiveCompany = createAsyncThunk("crm/companies/archive", async ({ id, reason }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/companies/${id}/archive`, { reason });
    toast.promise(res, { loading: "Archiving...", success: "Company archived in preview", error: "Failed to archive company" });
    const { data } = await res;
    return data.company;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to archive company");
  }
});

export const restoreCompany = createAsyncThunk("crm/companies/restore", async (id, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/companies/${id}/restore`);
    toast.promise(res, { loading: "Restoring...", success: "Company restored in preview", error: "Failed to restore company" });
    const { data } = await res;
    return data.company;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to restore company");
  }
});

export const linkContact = createAsyncThunk("crm/companies/linkContact", async ({ id, contactId }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/companies/${id}/contacts`, { contactId });
    toast.promise(res, { loading: "Linking contact...", success: "Contact linked in preview", error: "Failed to link contact" });
    const { data } = await res;
    return data.company;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to link contact");
  }
});

export const unlinkContact = createAsyncThunk("crm/companies/unlinkContact", async ({ id, contactId }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.delete(`/crm/companies/${id}/contacts/${contactId}`);
    toast.promise(res, { loading: "Removing...", success: "Contact removed in preview", error: "Failed to remove contact" });
    const { data } = await res;
    return data.company;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to remove contact");
  }
});

export const setPrimaryContact = createAsyncThunk("crm/companies/setPrimaryContact", async ({ id, contactId }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/companies/${id}/contacts/${contactId}/primary`);
    toast.promise(res, { loading: "Updating...", success: "Primary contact updated", error: "Failed to update primary contact" });
    const { data } = await res;
    return data.company;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to update primary contact");
  }
});

export const bulkAssignCompanies = createAsyncThunk("crm/companies/bulkAssign", async ({ companyIds, ownerId }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/crm/companies/bulk/assign", { companyIds, ownerId });
    toast.success(`${data.companies.length} compan${data.companies.length === 1 ? "y" : "ies"} reassigned in preview`);
    return data.companies;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk assign");
  }
});

export const bulkTagCompanies = createAsyncThunk("crm/companies/bulkTag", async ({ companyIds, tag }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/crm/companies/bulk/tag", { companyIds, tag });
    toast.success(`Tag added to ${data.companies.length} compan${data.companies.length === 1 ? "y" : "ies"} in preview`);
    return data.companies;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk tag");
  }
});

export const bulkLifecycleUpdateCompanies = createAsyncThunk("crm/companies/bulkLifecycle", async ({ companyIds, lifecycleStage }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/crm/companies/bulk/lifecycle", { companyIds, lifecycleStage });
    toast.success(`${data.companies.length} compan${data.companies.length === 1 ? "y" : "ies"} updated in preview`);
    return data.companies;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk update lifecycle");
  }
});

export const bulkArchiveCompanies = createAsyncThunk("crm/companies/bulkArchive", async ({ companyIds, reason }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/crm/companies/bulk/archive", { companyIds, reason });
    toast.success(`${data.companies.length} compan${data.companies.length === 1 ? "y" : "ies"} archived in preview`);
    return data.companies;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk archive");
  }
});

const initialState = { items: [], current: null, currentNotFound: false, loading: false, error: null, duplicates: [] };

const applyOne = (state, action) => {
  const updated = action.payload;
  if (!updated) return;
  state.items = state.items.map((c) => (c._id === updated._id ? updated : c));
  if (state.current?._id === updated._id) state.current = updated;
};
const applyMany = (state, action) => {
  const updated = action.payload || [];
  const byId = new Map(updated.map((c) => [c._id, c]));
  state.items = state.items.map((c) => byId.get(c._id) || c);
  if (state.current && byId.has(state.current._id)) state.current = byId.get(state.current._id);
};

const companiesSlice = createSlice({
  name: "companies",
  initialState,
  reducers: {
    clearCompanyDuplicates: (state) => {
      state.duplicates = [];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchCompanies.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCompanies.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload || [];
      })
      .addCase(fetchCompanies.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchCompany.pending, (state) => {
        state.current = null;
        state.currentNotFound = false;
      })
      .addCase(fetchCompany.fulfilled, (state, action) => {
        state.current = action.payload;
        state.currentNotFound = false;
      })
      .addCase(fetchCompany.rejected, (state) => {
        state.current = null;
        state.currentNotFound = true;
      })
      .addCase(createCompany.rejected, (state, action) => {
        state.duplicates = action.payload?.duplicates || [];
      })
      .addCase(createCompany.fulfilled, (state, action) => {
        if (action.payload) state.items.unshift(action.payload);
        state.duplicates = [];
      })
      .addCase(updateCompany.fulfilled, applyOne)
      .addCase(assignCompanyOwner.fulfilled, applyOne)
      .addCase(changeCompanyLifecycle.fulfilled, applyOne)
      .addCase(changeCompanyHealth.fulfilled, applyOne)
      .addCase(addCompanyNote.fulfilled, applyOne)
      .addCase(logCompanyActivity.fulfilled, applyOne)
      .addCase(createCompanyTask.fulfilled, applyOne)
      .addCase(updateCompanyTask.fulfilled, applyOne)
      .addCase(uploadCompanyFile.fulfilled, applyOne)
      .addCase(deleteCompanyFile.fulfilled, applyOne)
      .addCase(archiveCompany.fulfilled, applyOne)
      .addCase(restoreCompany.fulfilled, applyOne)
      .addCase(linkContact.fulfilled, applyOne)
      .addCase(unlinkContact.fulfilled, applyOne)
      .addCase(setPrimaryContact.fulfilled, applyOne)
      .addCase(bulkAssignCompanies.fulfilled, applyMany)
      .addCase(bulkTagCompanies.fulfilled, applyMany)
      .addCase(bulkLifecycleUpdateCompanies.fulfilled, applyMany)
      .addCase(bulkArchiveCompanies.fulfilled, applyMany);
  },
});

export const { clearCompanyDuplicates } = companiesSlice.actions;
export default companiesSlice.reducer;
