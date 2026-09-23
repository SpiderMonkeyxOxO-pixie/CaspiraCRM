import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";
import * as backendContacts from "../../Helpers/crmContactsBackend";
import { notSupported } from "../../Helpers/crmBackendCommon";

// Re-exported from mockCrmData for callers that already import enums from
// this slice — mockCrmData.js is the single source of truth for these lists.
export { CONTACT_RELATIONSHIP_TYPES, CONTACT_LIFECYCLE_STAGES, CONTACT_SOURCES } from "../../Helpers/mockCrmData";

// VITE_BACKEND_CRM_SALES_MODE=true reads/writes contacts through the real
// /crm/contacts API (crmContactsBackend.js translates shapes); otherwise the
// mock layer. Unsupported actions reject with a clear message instead of
// silently using mock data.
const BACKEND = backendContacts.BACKEND_ENABLED;
const errorMessage = (error, fallback) => error.response?.data?.message || (BACKEND ? error.message : null) || fallback;
const errorBody = (error, fallback) => error.response?.data || { message: (BACKEND && error.message) || fallback };
const asResponse = (promise, key) => promise.then((value) => ({ data: { [key]: value } }));

// fetchContacts takes the full filter/sort/page param set and returns
// exactly one page — same shape as Leads, so the store never holds more
// than the currently displayed page of contacts.
export const fetchContacts = createAsyncThunk("crm/contacts/fetchAll", async (params = {}, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendContacts.listContacts(params);
    const { data } = await axiosInstance.get("/crm/contacts", { params });
    return data; // { contacts, total, page, pageSize, summary }
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to load contacts"));
  }
});

// Fetches every contact matching the given filters, ignoring pagination —
// used for "export filtered results".
export const fetchAllMatchingContacts = createAsyncThunk(
  "crm/contacts/fetchAllMatching",
  async (params = {}, { rejectWithValue }) => {
    try {
      if (BACKEND) return await backendContacts.listAllMatchingContacts(params);
      const { data } = await axiosInstance.get("/crm/contacts", { params: { ...params, page: 1, pageSize: 100000 } });
      return data.contacts;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to export contacts"));
    }
  }
);

export const fetchContact = createAsyncThunk("crm/contacts/fetchOne", async (id, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendContacts.getContact(id);
    const { data } = await axiosInstance.get(`/crm/contacts/${id}`);
    return data.contact;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to load contact"));
  }
});

export const createContact = createAsyncThunk("crm/contacts/create", async (contactData, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendContacts.createContact(contactData);
    const { data } = await axiosInstance.post("/crm/contacts", contactData);
    return data.contact;
  } catch (error) {
    return rejectWithValue(errorBody(error, "Failed to create contact"));
  }
});

export const updateContact = createAsyncThunk("crm/contacts/update", async ({ id, changes }, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendContacts.updateContact(id, changes);
    const { data } = await axiosInstance.put(`/crm/contacts/${id}`, changes);
    return data.contact;
  } catch (error) {
    return rejectWithValue(errorBody(error, "Failed to update contact"));
  }
});

export const updateConsent = createAsyncThunk(
  "crm/contacts/updateConsent",
  async ({ id, optedIn, reason }, { rejectWithValue }) => {
    try {
      const res = BACKEND
        ? asResponse(backendContacts.updateContact(id, { marketingOptIn: optedIn }), "contact")
        : axiosInstance.post(`/crm/contacts/${id}/consent`, { optedIn, reason });
      toast.promise(res, {
        loading: "Updating preferences...",
        success: optedIn ? "Subscribed to marketing" : "Unsubscribed",
        error: "Failed to update preferences",
      });
      const { data } = await res;
      return data.contact;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to update preferences"));
    }
  }
);

export const assignContact = createAsyncThunk("crm/contacts/assign", async ({ id, ownerId }, { rejectWithValue }) => {
  try {
    const res = BACKEND ? asResponse(backendContacts.assignContact(id, ownerId), "contact") : axiosInstance.put(`/crm/contacts/${id}`, { ownerId });
    toast.promise(res, { loading: "Assigning...", success: BACKEND ? "Owner updated" : "Owner updated in preview", error: "Failed to reassign contact" });
    const { data } = await res;
    return data.contact;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to reassign contact"));
  }
});

export const changeLifecycle = createAsyncThunk("crm/contacts/changeLifecycle", async ({ id, lifecycleStage, reason }, { rejectWithValue }) => {
  try {
    const res = BACKEND
      ? asResponse(backendContacts.updateContact(id, { lifecycleStage }), "contact")
      : axiosInstance.put(`/crm/contacts/${id}`, { lifecycleStage, lifecycleChangeReason: reason });
    toast.promise(res, { loading: "Updating lifecycle...", success: BACKEND ? "Lifecycle updated" : "Lifecycle updated in preview", error: "Failed to update lifecycle" });
    const { data } = await res;
    return data.contact;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to update lifecycle"));
  }
});

export const setDoNotContact = createAsyncThunk("crm/contacts/setDoNotContact", async ({ id, doNotContact, reason }, { rejectWithValue }) => {
  try {
    const res = BACKEND
      ? asResponse(backendContacts.updateContact(id, { doNotContact, doNotContactReason: reason }), "contact")
      : axiosInstance.put(`/crm/contacts/${id}`, { doNotContact, doNotContactReason: reason });
    const where = BACKEND ? "" : " in preview";
    toast.promise(res, {
      loading: "Updating...",
      success: doNotContact ? `Marked Do Not Contact${where}` : `Do Not Contact removed${where}`,
      error: "Failed to update contact",
    });
    const { data } = await res;
    return data.contact;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to update contact"));
  }
});

export const addContactNote = createAsyncThunk("crm/contacts/addNote", async ({ id, message }, { rejectWithValue }) => {
  if (!message?.trim()) return rejectWithValue("Note cannot be empty");
  try {
    if (BACKEND) return await backendContacts.addContactNote(id, message);
    const { data } = await axiosInstance.post(`/crm/contacts/${id}/notes`, { message });
    return data.contact;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to add note"));
  }
});

export const logContactActivity = createAsyncThunk(
  "crm/contacts/logActivity",
  async ({ id, type, description }, { rejectWithValue }) => {
    try {
      // Stored as a labelled note on the contact in backend mode.
      const res = BACKEND
        ? asResponse(backendContacts.addContactNote(id, `[${type || "note"}] ${description}`), "contact")
        : axiosInstance.post(`/crm/contacts/${id}/activity`, { type, description });
      toast.promise(res, { loading: "Logging activity...", success: "Activity logged", error: "Failed to log activity" });
      const { data } = await res;
      return data.contact;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to log activity"));
    }
  }
);

export const createContactTask = createAsyncThunk("crm/contacts/createTask", async ({ id, task }, { rejectWithValue }) => {
  try {
    const res = BACKEND ? Promise.reject(notSupported("Contact tasks")) : axiosInstance.post(`/crm/contacts/${id}/tasks`, task);
    toast.promise(res, { loading: "Adding task...", success: "Task added", error: (err) => errorMessage(err, "Failed to add task") });
    const { data } = await res;
    return data.contact;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to add task"));
  }
});

export const updateContactTask = createAsyncThunk("crm/contacts/updateTask", async ({ id, taskId, changes }, { rejectWithValue }) => {
  try {
    if (BACKEND) throw notSupported("Contact tasks");
    const { data } = await axiosInstance.put(`/crm/contacts/${id}/tasks/${taskId}`, changes);
    return data.contact;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to update task"));
  }
});

export const uploadContactFile = createAsyncThunk("crm/contacts/uploadFile", async ({ id, file }, { rejectWithValue }) => {
  try {
    const res = BACKEND ? Promise.reject(notSupported("File uploads")) : axiosInstance.post(`/crm/contacts/${id}/files`, file);
    toast.promise(res, { loading: "Uploading...", success: "File added to preview", error: (err) => errorMessage(err, "Failed to upload file") });
    const { data } = await res;
    return data.contact;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to upload file"));
  }
});

export const deleteContactFile = createAsyncThunk("crm/contacts/deleteFile", async ({ id, fileId }, { rejectWithValue }) => {
  try {
    if (BACKEND) throw notSupported("File uploads");
    const { data } = await axiosInstance.delete(`/crm/contacts/${id}/files/${fileId}`);
    return data.contact;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to remove file"));
  }
});

export const archiveContact = createAsyncThunk("crm/contacts/archive", async ({ id, reason }, { rejectWithValue }) => {
  try {
    const res = BACKEND ? asResponse(backendContacts.archiveContact(id, reason), "contact") : axiosInstance.post(`/crm/contacts/${id}/archive`, { reason });
    toast.promise(res, { loading: "Archiving...", success: BACKEND ? "Contact archived" : "Contact archived in preview", error: "Failed to archive contact" });
    const { data } = await res;
    return data.contact;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to archive contact"));
  }
});

export const restoreContact = createAsyncThunk("crm/contacts/restore", async (id, { rejectWithValue }) => {
  try {
    const res = BACKEND ? asResponse(backendContacts.restoreContact(id), "contact") : axiosInstance.post(`/crm/contacts/${id}/restore`);
    toast.promise(res, { loading: "Restoring...", success: BACKEND ? "Contact restored" : "Contact restored in preview", error: "Failed to restore contact" });
    const { data } = await res;
    return data.contact;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to restore contact"));
  }
});

const where = BACKEND ? "" : " in preview";

export const bulkAssignContacts = createAsyncThunk("crm/contacts/bulkAssign", async ({ contactIds, ownerId }, { rejectWithValue }) => {
  try {
    const contacts = BACKEND
      ? await backendContacts.bulkAssignContacts(contactIds, ownerId)
      : (await axiosInstance.post("/crm/contacts/bulk/assign", { contactIds, ownerId })).data.contacts;
    toast.success(`${contacts.length} contact(s) reassigned${where}`);
    return contacts;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to bulk assign"));
  }
});

export const bulkTagContacts = createAsyncThunk("crm/contacts/bulkTag", async ({ contactIds, tag }, { rejectWithValue }) => {
  try {
    if (BACKEND) throw notSupported("Tagging");
    const { data } = await axiosInstance.post("/crm/contacts/bulk/tag", { contactIds, tag });
    toast.success(`Tag added to ${data.contacts.length} contact(s) in preview`);
    return data.contacts;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to bulk tag"));
  }
});

export const bulkLifecycleUpdateContacts = createAsyncThunk("crm/contacts/bulkLifecycle", async ({ contactIds, lifecycleStage }, { rejectWithValue }) => {
  try {
    const contacts = BACKEND
      ? await backendContacts.bulkLifecycleContacts(contactIds, lifecycleStage)
      : (await axiosInstance.post("/crm/contacts/bulk/lifecycle", { contactIds, lifecycleStage })).data.contacts;
    toast.success(`${contacts.length} contact(s) updated${where}`);
    return contacts;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to bulk update lifecycle"));
  }
});

export const bulkArchiveContacts = createAsyncThunk("crm/contacts/bulkArchive", async ({ contactIds, reason }, { rejectWithValue }) => {
  try {
    const contacts = BACKEND
      ? await backendContacts.bulkArchiveContacts(contactIds, reason)
      : (await axiosInstance.post("/crm/contacts/bulk/archive", { contactIds, reason })).data.contacts;
    toast.success(`${contacts.length} contact(s) archived${where}`);
    return contacts;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to bulk archive"));
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
