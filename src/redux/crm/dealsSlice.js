import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";

// Re-exported from mockCrmData — the single source of truth for these lists
// and for the one place stage probabilities are configured.
export {
  DEAL_PIPELINES, DEAL_STAGES, DEAL_OUTCOME_STAGES, DEAL_STAGE_PROBABILITY, DEAL_STAGE_COLORS, DEAL_STATUSES,
  DEAL_TYPES, DEAL_SOURCES, DEAL_CURRENCIES, DEAL_PRIORITIES, DEAL_HEALTH_STATES,
  DEAL_BILLING_FREQUENCIES, DEAL_LOSS_REASONS, DEAL_CONTACT_ROLES, DEAL_CONTACT_INFLUENCE_LEVELS,
  DEAL_CONTACT_RELATIONSHIPS, DEAL_STAGE_RECOMMENDATIONS, DEAL_REASON_REQUIRED_STAGES,
  PIPELINE_CONFIGS, findPipelineConfig,
  computeLineItemTotals,
} from "../../Helpers/mockCrmData";

// Deliberately NOT server-shaped/paginated, like Companies and Activities:
// CompaniesList and the CRM dashboard already consume the full deals list
// via this same thunk. DealsList filters/sorts/paginates client-side over
// this full array using the shared queryDealsLocal() utility.
export const fetchDeals = createAsyncThunk("crm/deals/fetchAll", async (_, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/crm/deals");
    return data.deals;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load deals");
  }
});

export const fetchDeal = createAsyncThunk("crm/deals/fetchOne", async (id, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get(`/crm/deals/${id}`);
    return data.deal;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Deal not found");
  }
});

export const createDeal = createAsyncThunk("crm/deals/create", async (dealData, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/crm/deals", dealData);
    return data.deal;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to create deal" });
  }
});

export const updateDeal = createAsyncThunk("crm/deals/update", async ({ id, changes }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.put(`/crm/deals/${id}`, changes);
    return data.deal;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to update deal" });
  }
});

export const changeDealStage = createAsyncThunk("crm/deals/changeStage", async ({ id, stage, note }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/deals/${id}/stage`, { stage, note });
    toast.promise(res, { loading: "Updating stage...", success: `Stage updated to ${stage} in preview`, error: "Failed to update stage" });
    const { data } = await res;
    return data.deal;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to update stage");
  }
});

export const markDealWon = createAsyncThunk("crm/deals/markWon", async ({ id, ...payload }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/deals/${id}/win`, payload);
    toast.promise(res, { loading: "Marking deal as won...", success: "Deal marked Won in preview", error: "Failed to mark deal Won" });
    const { data } = await res;
    return data.deal;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to mark deal Won");
  }
});

export const markDealLost = createAsyncThunk("crm/deals/markLost", async ({ id, ...payload }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/deals/${id}/lost`, payload);
    toast.promise(res, { loading: "Marking deal as lost...", success: "Deal marked Lost in preview", error: "Failed to mark deal Lost" });
    const { data } = await res;
    return data.deal;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to mark deal Lost");
  }
});

export const cancelDeal = createAsyncThunk("crm/deals/cancel", async ({ id, ...payload }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/deals/${id}/cancel`, payload);
    toast.promise(res, { loading: "Cancelling deal...", success: "Deal cancelled in preview", error: "Failed to cancel deal" });
    const { data } = await res;
    return data.deal;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to cancel deal");
  }
});

export const putDealOnHold = createAsyncThunk("crm/deals/hold", async ({ id, ...payload }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/deals/${id}/hold`, payload);
    toast.promise(res, { loading: "Putting deal on hold...", success: "Deal put on hold in preview", error: "Failed to put deal on hold" });
    const { data } = await res;
    return data.deal;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to put deal on hold");
  }
});

export const reopenDeal = createAsyncThunk("crm/deals/reopen", async ({ id, ...payload }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/deals/${id}/reopen`, payload);
    toast.promise(res, { loading: "Reopening deal...", success: "Deal reopened in preview", error: "Failed to reopen deal" });
    const { data } = await res;
    return data.deal;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to reopen deal");
  }
});

export const archiveDeal = createAsyncThunk("crm/deals/archive", async ({ id, reason }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/deals/${id}/archive`, { reason });
    toast.promise(res, { loading: "Archiving...", success: "Deal archived in preview", error: "Failed to archive deal" });
    const { data } = await res;
    return data.deal;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to archive deal");
  }
});

export const restoreDeal = createAsyncThunk("crm/deals/restore", async (id, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/deals/${id}/restore`);
    toast.promise(res, { loading: "Restoring...", success: "Deal restored in preview", error: "Failed to restore deal" });
    const { data } = await res;
    return data.deal;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to restore deal");
  }
});

export const addDealContact = createAsyncThunk("crm/deals/addContact", async ({ id, ...payload }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/deals/${id}/contacts`, payload);
    toast.promise(res, { loading: "Adding contact...", success: "Contact added in preview", error: "Failed to add contact" });
    const { data } = await res;
    return data.deal;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to add contact");
  }
});

export const updateDealContactRole = createAsyncThunk("crm/deals/updateContactRole", async ({ id, contactId, changes }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.put(`/crm/deals/${id}/contacts/${contactId}`, changes);
    return data.deal;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to update contact role");
  }
});

export const setDealPrimaryContact = createAsyncThunk("crm/deals/setPrimaryContact", async ({ id, contactId }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/deals/${id}/contacts/${contactId}/primary`);
    toast.promise(res, { loading: "Updating...", success: "Primary contact updated", error: "Failed to update primary contact" });
    const { data } = await res;
    return data.deal;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to update primary contact");
  }
});

export const removeDealContact = createAsyncThunk("crm/deals/removeContact", async ({ id, contactId }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.delete(`/crm/deals/${id}/contacts/${contactId}`);
    toast.promise(res, { loading: "Removing...", success: "Contact removed in preview", error: "Failed to remove contact" });
    const { data } = await res;
    return data.deal;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to remove contact");
  }
});

export const setDealLineItems = createAsyncThunk("crm/deals/setLineItems", async ({ id, lineItems }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.put(`/crm/deals/${id}/line-items`, { lineItems });
    return data.deal;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to update products" });
  }
});

export const addDealQuotePreview = createAsyncThunk("crm/deals/addQuotePreview", async ({ id, ...payload }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post(`/crm/deals/${id}/quotes`, payload);
    return data.deal;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to add quote preview");
  }
});

export const uploadDealFile = createAsyncThunk("crm/deals/uploadFile", async ({ id, file }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/crm/deals/${id}/files`, file);
    toast.promise(res, { loading: "Uploading...", success: "File added to preview", error: "Failed to upload file" });
    const { data } = await res;
    return data.deal;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to upload file");
  }
});

export const deleteDealFile = createAsyncThunk("crm/deals/deleteFile", async ({ id, fileId }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.delete(`/crm/deals/${id}/files/${fileId}`);
    return data.deal;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to remove file");
  }
});

export const bulkAssignDeals = createAsyncThunk("crm/deals/bulkAssign", async ({ dealIds, ownerId }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/crm/deals/bulk/assign", { dealIds, ownerId });
    toast.success(`${data.deals.length} deal${data.deals.length === 1 ? "" : "s"} reassigned in preview`);
    return data.deals;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk assign");
  }
});

export const bulkStageChangeDeals = createAsyncThunk("crm/deals/bulkStage", async ({ dealIds, stage }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/crm/deals/bulk/stage", { dealIds, stage });
    toast.success(`${data.deals.length} deal${data.deals.length === 1 ? "" : "s"} moved to ${stage} in preview`);
    return data.deals;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk change stage");
  }
});

export const bulkTagDeals = createAsyncThunk("crm/deals/bulkTag", async ({ dealIds, tag }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/crm/deals/bulk/tag", { dealIds, tag });
    toast.success(`Tag added to ${data.deals.length} deal${data.deals.length === 1 ? "" : "s"} in preview`);
    return data.deals;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk tag");
  }
});

export const bulkArchiveDeals = createAsyncThunk("crm/deals/bulkArchive", async ({ dealIds, reason }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/crm/deals/bulk/archive", { dealIds, reason });
    toast.success(`${data.deals.length} deal${data.deals.length === 1 ? "" : "s"} archived in preview`);
    return data.deals;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk archive");
  }
});

const initialState = { items: [], current: null, currentNotFound: false, loading: false, error: null };

const applyOne = (state, action) => {
  const updated = action.payload;
  if (!updated) return;
  state.items = state.items.map((d) => (d._id === updated._id ? updated : d));
  if (state.current?._id === updated._id) state.current = updated;
};
const applyMany = (state, action) => {
  const updated = action.payload || [];
  const byId = new Map(updated.map((d) => [d._id, d]));
  state.items = state.items.map((d) => byId.get(d._id) || d);
  if (state.current && byId.has(state.current._id)) state.current = byId.get(state.current._id);
};

const dealsSlice = createSlice({
  name: "deals",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchDeals.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchDeals.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload || [];
      })
      .addCase(fetchDeals.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchDeal.pending, (state) => {
        state.current = null;
        state.currentNotFound = false;
      })
      .addCase(fetchDeal.fulfilled, (state, action) => {
        state.current = action.payload;
        state.currentNotFound = false;
      })
      .addCase(fetchDeal.rejected, (state) => {
        state.current = null;
        state.currentNotFound = true;
      })
      .addCase(createDeal.fulfilled, (state, action) => {
        if (action.payload) state.items.unshift(action.payload);
      });

    [
      updateDeal, changeDealStage, markDealWon, markDealLost, cancelDeal, putDealOnHold, reopenDeal,
      archiveDeal, restoreDeal, addDealContact, updateDealContactRole, setDealPrimaryContact,
      removeDealContact, setDealLineItems, addDealQuotePreview, uploadDealFile, deleteDealFile,
    ].forEach((thunk) => builder.addCase(thunk.fulfilled, applyOne));

    [bulkAssignDeals, bulkStageChangeDeals, bulkTagDeals, bulkArchiveDeals].forEach((thunk) =>
      builder.addCase(thunk.fulfilled, applyMany)
    );
  },
});

export default dealsSlice.reducer;
