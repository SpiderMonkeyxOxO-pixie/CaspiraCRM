import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";

// Re-exported from mockCrmData for callers that already import enums from
// this slice — mockCrmData.js is the single source of truth for these lists.
export { CONTACT_RELATIONSHIP_TYPES, CONTACT_LIFECYCLE_STAGES, CONTACT_SOURCES } from "../../Helpers/mockCrmData";

// fetchContacts takes the full filter/sort/page param set and returns
// exactly one page — same shape as Leads, so the store never holds more
// than the currently displayed page of contacts.
export const fetchContacts = createAsyncThunk("crm/contacts/fetchAll", async (params = {}, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/crm/contacts", { params });
    return data; // { contacts, total, page, pageSize, summary }
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load contacts");
  }
});

// Fetches every contact matching the given filters, ignoring pagination —
// used for "export filtered results".
export const fetchAllMatchingContacts = createAsyncThunk(
  "crm/contacts/fetchAllMatching",
  async (params = {}, { rejectWithValue }) => {
    try {
      const { data } = await axiosInstance.get("/crm/contacts", { params: { ...params, page: 1, pageSize: 100000 } });
      return data.contacts;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to export contacts");
    }
  }
);

export const fetchContact = createAsyncThunk("crm/contacts/fetchOne", async (id, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get(`/crm/contacts/${id}`);
    return data.contact;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load contact");
  }
});

export const createContact = createAsyncThunk("crm/contacts/create", async (contactData, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/crm/contacts", contactData);
    return data.contact;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to create contact" });
  }
});

export const updateContact = createAsyncThunk("crm/contacts/update", async ({ id, changes }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.put(`/crm/contacts/${id}`, changes);
    return data.contact;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to update contact" });
  }
});

export const updateConsent = createAsyncThunk(
  "crm/contacts/updateConsent",
  async ({ id, optedIn, reason }, { rejectWithValue }) => {
    try {
      const res = axiosInstance.post(`/crm/contacts/${id}/consent`, { optedIn, reason });
      toast.promise(res, {
        loading: "Updating preferences...",
        success: optedIn ? "Subscribed to marketing" : "Unsubscribed",
        error: "Failed to update preferences",
      });
      const { data } = await res;
      return data.contact;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to update preferences");
    }
  }
);

export const assignContact = createAsyncThunk("crm/contacts/assign", async ({ id, ownerId }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.put(`/crm/contacts/${id}`, { ownerId });
    toast.promise(res, { loading: "Assigning...", success: "Owner updated in preview", error: "Failed to reassign contact" });
    const { data } = await res;
    return data.contact;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to reassign contact");
  }
});

export const changeLifecycle = createAsyncThunk("crm/contacts/changeLifecycle", async ({ id, lifecycleStage, reason }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.put(`/crm/contacts/${id}`, { lifecycleStage, lifecycleChangeReason: reason });
    toast.promise(res, { loading: "Updating lifecycle...", success: "Lifecycle updated in preview", error: "Failed to update lifecycle" });
    const { data } = await res;
    return data.contact;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to update lifecycle");
  }
});

export const setDoNotContact = createAsyncThunk("crm/contacts/setDoNotContact", async ({ id, doNotContact, reason }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.put(`/crm/contacts/${id}`, { doNotContact, doNotContactReason: reason });
    toast.promise(res, {
      loading: "Updating...",
      success: doNotContact ? "Marked Do Not Contact in preview" : "Do Not Contact removed in preview",
      error: "Failed to update contact",
    });
    const { data } = await res;
    return data.contact;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to update contact");
  }
});

export const addContactNote = createAsyncThunk("crm/contacts/addNote", async ({ id, message }, { rejectWithValue }) => {
  if (!message?.trim()) return rejectWithValue("Note cannot be empty");
  try {
    const { data } = await axiosInstance.post(`/crm/contacts/${id}/notes`, { message });
    return data.contact;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to add note");
  }
});

export const logContactActivity = createAsyncThunk(
  "crm/contacts/logActivity",
  async ({ id, type, description }, { rejectWithValue }) => {
    try {
      const res = axiosInstance.post(`/crm/contacts/${id}/activity`, { type, description });
      toast.promise(res, { loading: "Logging activity...", success: "Activity logged", error: "Failed to log activity" });
      const { data } = await res;
      return data.contact;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to log activity");
    }
  }
);

export const createContactTask = createAsyncThunk("crm/contacts/createTask", async ({ id, task }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/contacts/${id}/tasks`, task);
    toast.promise(res, { loading: "Adding task...", success: "Task added", error: "Failed to add task" });
    const { data } = await res;
    return data.contact;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to add task");
  }
});

export const updateContactTask = createAsyncThunk("crm/contacts/updateTask", async ({ id, taskId, changes }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.put(`/crm/contacts/${id}/tasks/${taskId}`, changes);
    return data.contact;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to update task");
  }
});

export const uploadContactFile = createAsyncThunk("crm/contacts/uploadFile", async ({ id, file }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/contacts/${id}/files`, file);
    toast.promise(res, { loading: "Uploading...", success: "File added to preview", error: "Failed to upload file" });
    const { data } = await res;
    return data.contact;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to upload file");
  }
});

export const deleteContactFile = createAsyncThunk("crm/contacts/deleteFile", async ({ id, fileId }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.delete(`/crm/contacts/${id}/files/${fileId}`);
    return data.contact;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to remove file");
  }
});

export const archiveContact = createAsyncThunk("crm/contacts/archive", async ({ id, reason }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/contacts/${id}/archive`, { reason });
    toast.promise(res, { loading: "Archiving...", success: "Contact archived in preview", error: "Failed to archive contact" });
    const { data } = await res;
    return data.contact;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to archive contact");
  }
});

export const restoreContact = createAsyncThunk("crm/contacts/restore", async (id, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/contacts/${id}/restore`);
    toast.promise(res, { loading: "Restoring...", success: "Contact restored in preview", error: "Failed to restore contact" });
    const { data } = await res;
    return data.contact;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to restore contact");
  }
});

export const bulkAssignContacts = createAsyncThunk("crm/contacts/bulkAssign", async ({ contactIds, ownerId }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/crm/contacts/bulk/assign", { contactIds, ownerId });
    toast.success(`${data.contacts.length} contact(s) reassigned in preview`);
    return data.contacts;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk assign");
  }
});

export const bulkTagContacts = createAsyncThunk("crm/contacts/bulkTag", async ({ contactIds, tag }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/crm/contacts/bulk/tag", { contactIds, tag });
    toast.success(`Tag added to ${data.contacts.length} contact(s) in preview`);
    return data.contacts;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk tag");
  }
});

export const bulkLifecycleUpdateContacts = createAsyncThunk("crm/contacts/bulkLifecycle", async ({ contactIds, lifecycleStage }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/crm/contacts/bulk/lifecycle", { contactIds, lifecycleStage });
    toast.success(`${data.contacts.length} contact(s) updated in preview`);
    return data.contacts;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk update lifecycle");
  }
});

export const bulkArchiveContacts = createAsyncThunk("crm/contacts/bulkArchive", async ({ contactIds, reason }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/crm/contacts/bulk/archive", { contactIds, reason });
    toast.success(`${data.contacts.length} contact(s) archived in preview`);
    return data.contacts;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk archive");
  }
});

const initialState = {
  items: [],
  current: null,
  currentNotFound: false,
  total: 0,
  page: 1,
  pageSize: 20,
  summary: { total: 0, prospects: 0, activeCustomers: 0, followUpsDue: 0, overdueFollowUps: 0, doNotContact: 0 },
  loading: false,
  error: null,
  duplicates: [],
};

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

const contactsSlice = createSlice({
  name: "contacts",
  initialState,
  reducers: {
    clearContactDuplicates: (state) => {
      state.duplicates = [];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchContacts.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchContacts.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload.contacts || [];
        state.total = action.payload.total || 0;
        state.page = action.payload.page || 1;
        state.pageSize = action.payload.pageSize || 20;
        state.summary = action.payload.summary || initialState.summary;
      })
      .addCase(fetchContacts.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchContact.pending, (state) => {
        state.current = null;
        state.currentNotFound = false;
      })
      .addCase(fetchContact.fulfilled, (state, action) => {
        state.current = action.payload;
        state.currentNotFound = false;
      })
      .addCase(fetchContact.rejected, (state) => {
        // Mock data lives only in memory and is reseeded on every full page
        // load — a stale/bookmarked contact URL genuinely stops resolving.
        state.current = null;
        state.currentNotFound = true;
      })
      .addCase(createContact.rejected, (state, action) => {
        state.duplicates = action.payload?.duplicates || [];
      })
      .addCase(createContact.fulfilled, (state, action) => {
        if (action.payload) {
          state.items.unshift(action.payload);
          state.total += 1;
        }
        state.duplicates = [];
      })
      .addCase(updateContact.fulfilled, applyOne)
      .addCase(updateConsent.fulfilled, applyOne)
      .addCase(assignContact.fulfilled, applyOne)
      .addCase(changeLifecycle.fulfilled, applyOne)
      .addCase(setDoNotContact.fulfilled, applyOne)
      .addCase(addContactNote.fulfilled, applyOne)
      .addCase(logContactActivity.fulfilled, applyOne)
      .addCase(createContactTask.fulfilled, applyOne)
      .addCase(updateContactTask.fulfilled, applyOne)
      .addCase(uploadContactFile.fulfilled, applyOne)
      .addCase(deleteContactFile.fulfilled, applyOne)
      .addCase(archiveContact.fulfilled, applyOne)
      .addCase(restoreContact.fulfilled, applyOne)
      .addCase(bulkAssignContacts.fulfilled, applyMany)
      .addCase(bulkTagContacts.fulfilled, applyMany)
      .addCase(bulkLifecycleUpdateContacts.fulfilled, applyMany)
      .addCase(bulkArchiveContacts.fulfilled, applyMany);
  },
});

export const { clearContactDuplicates } = contactsSlice.actions;
export default contactsSlice.reducer;
