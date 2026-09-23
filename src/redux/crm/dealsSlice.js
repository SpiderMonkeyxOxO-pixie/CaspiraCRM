import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";
import * as backendDeals from "../../Helpers/crmDealsBackend";
import { notSupported } from "../../Helpers/crmBackendCommon";

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


// VITE_BACKEND_CRM_SALES_MODE=true reads/writes deals through the real
// /sales/deals API (crmDealsBackend.js resolves pipeline/stage names and
// translates shapes); otherwise the mock layer.
const BACKEND = backendDeals.BACKEND_ENABLED;
const errorMessage = (error, fallback) => error.response?.data?.message || (BACKEND ? error.message : null) || fallback;
const errorBody = (error, fallback) => error.response?.data || { message: (BACKEND && error.message) || fallback };
const where = BACKEND ? "" : " in preview";
const deals = (n) => `deal${n === 1 ? "" : "s"}`;

// Runs the backend call or the mock request, with the same toast either way.
async function run({ backend, mock, toastText }) {
  const res = BACKEND ? backend().then((deal) => ({ data: { deal } })) : mock();
  if (toastText) toast.promise(res, toastText);
  const { data } = await res;
  return data.deal;
}

// Deliberately NOT server-shaped/paginated, like Companies and Activities:
// CompaniesList and the CRM dashboard already consume the full deals list
// via this same thunk. DealsList filters/sorts/paginates client-side over
// this full array using the shared queryDealsLocal() utility.
export const fetchDeals = createAsyncThunk("crm/deals/fetchAll", async (_, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendDeals.listDeals();
    const { data } = await axiosInstance.get("/crm/deals");
    return data.deals;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to load deals"));
  }
});

export const fetchDeal = createAsyncThunk("crm/deals/fetchOne", async (id, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendDeals.getDeal(id);
    const { data } = await axiosInstance.get(`/crm/deals/${id}`);
    return data.deal;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Deal not found"));
  }
});

export const createDeal = createAsyncThunk("crm/deals/create", async (dealData, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendDeals.createDeal(dealData);
    const { data } = await axiosInstance.post("/crm/deals", dealData);
    return data.deal;
  } catch (error) {
    return rejectWithValue(errorBody(error, "Failed to create deal"));
  }
});

export const updateDeal = createAsyncThunk("crm/deals/update", async ({ id, changes }, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendDeals.updateDeal(id, changes);
    const { data } = await axiosInstance.put(`/crm/deals/${id}`, changes);
    return data.deal;
  } catch (error) {
    return rejectWithValue(errorBody(error, "Failed to update deal"));
  }
});

export const changeDealStage = createAsyncThunk("crm/deals/changeStage", async ({ id, stage, note }, { rejectWithValue }) => {
  try {
    return await run({
      backend: () => backendDeals.changeStage(id, { stage, note }),
      mock: () => axiosInstance.post(`/crm/deals/${id}/stage`, { stage, note }),
      toastText: { loading: "Updating stage...", success: `Stage updated to ${stage}${where}`, error: (err) => errorMessage(err, "Failed to update stage") },
    });
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to update stage"));
  }
});

export const markDealWon = createAsyncThunk("crm/deals/markWon", async ({ id, ...payload }, { rejectWithValue }) => {
  try {
    return await run({
      backend: () => backendDeals.markWon(id, payload),
      mock: () => axiosInstance.post(`/crm/deals/${id}/win`, payload),
      toastText: { loading: "Marking deal as won...", success: `Deal marked Won${where}`, error: (err) => errorMessage(err, "Failed to mark deal Won") },
    });
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to mark deal Won"));
  }
});

export const markDealLost = createAsyncThunk("crm/deals/markLost", async ({ id, ...payload }, { rejectWithValue }) => {
  try {
    return await run({
      backend: () => backendDeals.markLost(id, payload),
      mock: () => axiosInstance.post(`/crm/deals/${id}/lost`, payload),
      toastText: { loading: "Marking deal as lost...", success: `Deal marked Lost${where}`, error: (err) => errorMessage(err, "Failed to mark deal Lost") },
    });
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to mark deal Lost"));
  }
});

export const cancelDeal = createAsyncThunk("crm/deals/cancel", async ({ id, ...payload }, { rejectWithValue }) => {
  try {
    return await run({
      backend: () => backendDeals.cancelDeal(id, payload),
      mock: () => axiosInstance.post(`/crm/deals/${id}/cancel`, payload),
      toastText: { loading: "Cancelling deal...", success: `Deal cancelled${where}`, error: (err) => errorMessage(err, "Failed to cancel deal") },
    });
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to cancel deal"));
  }
});

export const putDealOnHold = createAsyncThunk("crm/deals/hold", async ({ id, ...payload }, { rejectWithValue }) => {
  try {
    return await run({
      backend: () => backendDeals.putOnHold(id, payload),
      mock: () => axiosInstance.post(`/crm/deals/${id}/hold`, payload),
      toastText: { loading: "Putting deal on hold...", success: `Deal put on hold${where}`, error: (err) => errorMessage(err, "Failed to put deal on hold") },
    });
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to put deal on hold"));
  }
});

export const reopenDeal = createAsyncThunk("crm/deals/reopen", async ({ id, ...payload }, { rejectWithValue }) => {
  try {
    return await run({
      backend: () => backendDeals.reopen(id, payload),
      mock: () => axiosInstance.post(`/crm/deals/${id}/reopen`, payload),
      toastText: { loading: "Reopening deal...", success: `Deal reopened${where}`, error: (err) => errorMessage(err, "Failed to reopen deal") },
    });
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to reopen deal"));
  }
});

export const archiveDeal = createAsyncThunk("crm/deals/archive", async ({ id, reason }, { rejectWithValue }) => {
  try {
    return await run({
      backend: () => backendDeals.archiveDeal(id, reason),
      mock: () => axiosInstance.post(`/crm/deals/${id}/archive`, { reason }),
      toastText: { loading: "Archiving...", success: `Deal archived${where}`, error: "Failed to archive deal" },
    });
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to archive deal"));
  }
});

export const restoreDeal = createAsyncThunk("crm/deals/restore", async (id, { rejectWithValue }) => {
  try {
    return await run({
      backend: () => backendDeals.restoreDeal(id),
      mock: () => axiosInstance.post(`/crm/deals/${id}/restore`),
      toastText: { loading: "Restoring...", success: `Deal restored${where}`, error: "Failed to restore deal" },
    });
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to restore deal"));
  }
});

export const addDealContact = createAsyncThunk("crm/deals/addContact", async ({ id, ...payload }, { rejectWithValue }) => {
  try {
    return await run({
      backend: () => backendDeals.addContact(id, payload),
      mock: () => axiosInstance.post(`/crm/deals/${id}/contacts`, payload),
      toastText: { loading: "Adding contact...", success: `Contact added${where}`, error: "Failed to add contact" },
    });
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to add contact"));
  }
});

export const updateDealContactRole = createAsyncThunk("crm/deals/updateContactRole", async ({ id, contactId, changes }, { rejectWithValue }) => {
  try {
    return await run({
      backend: () => backendDeals.updateContactRole(id, contactId, changes),
      mock: () => axiosInstance.put(`/crm/deals/${id}/contacts/${contactId}`, changes),
    });
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to update contact role"));
  }
});

export const setDealPrimaryContact = createAsyncThunk("crm/deals/setPrimaryContact", async ({ id, contactId }, { rejectWithValue }) => {
  try {
    return await run({
      backend: () => backendDeals.setPrimaryContact(id, contactId),
      mock: () => axiosInstance.post(`/crm/deals/${id}/contacts/${contactId}/primary`),
      toastText: { loading: "Updating...", success: "Primary contact updated", error: "Failed to update primary contact" },
    });
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to update primary contact"));
  }
});

export const removeDealContact = createAsyncThunk("crm/deals/removeContact", async ({ id, contactId }, { rejectWithValue }) => {
  try {
    return await run({
      backend: () => backendDeals.removeContact(id, contactId),
      mock: () => axiosInstance.delete(`/crm/deals/${id}/contacts/${contactId}`),
      toastText: { loading: "Removing...", success: `Contact removed${where}`, error: "Failed to remove contact" },
    });
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to remove contact"));
  }
});

export const setDealLineItems = createAsyncThunk("crm/deals/setLineItems", async ({ id, lineItems }, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendDeals.setLineItems(id, lineItems);
    const { data } = await axiosInstance.put(`/crm/deals/${id}/line-items`, { lineItems });
    return data.deal;
  } catch (error) {
    return rejectWithValue(errorBody(error, "Failed to update products"));
  }
});

export const addDealQuotePreview = createAsyncThunk("crm/deals/addQuotePreview", async ({ id, ...payload }, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendDeals.addQuotePreview(id, payload);
    const { data } = await axiosInstance.post(`/crm/deals/${id}/quotes`, payload);
    return data.deal;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to add quote preview"));
  }
});

export const uploadDealFile = createAsyncThunk("crm/deals/uploadFile", async ({ id, file }, { rejectWithValue }) => {
  try {
    return await run({
      backend: () => Promise.reject(notSupported("File uploads")),
      mock: () => axiosInstance.post(`/crm/deals/${id}/files`, file),
      toastText: { loading: "Uploading...", success: "File added to preview", error: (err) => errorMessage(err, "Failed to upload file") },
    });
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to upload file"));
  }
});

export const deleteDealFile = createAsyncThunk("crm/deals/deleteFile", async ({ id, fileId }, { rejectWithValue }) => {
  try {
    if (BACKEND) throw notSupported("File uploads");
    const { data } = await axiosInstance.delete(`/crm/deals/${id}/files/${fileId}`);
    return data.deal;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to remove file"));
  }
});

export const bulkAssignDeals = createAsyncThunk("crm/deals/bulkAssign", async ({ dealIds, ownerId }, { rejectWithValue }) => {
  try {
    const list = BACKEND ? await backendDeals.bulkAssign(dealIds, ownerId) : (await axiosInstance.post("/crm/deals/bulk/assign", { dealIds, ownerId })).data.deals;
    toast.success(`${list.length} ${deals(list.length)} reassigned${where}`);
    return list;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to bulk assign"));
  }
});

export const bulkStageChangeDeals = createAsyncThunk("crm/deals/bulkStage", async ({ dealIds, stage }, { rejectWithValue }) => {
  try {
    const list = BACKEND ? await backendDeals.bulkStage(dealIds, stage) : (await axiosInstance.post("/crm/deals/bulk/stage", { dealIds, stage })).data.deals;
    const skipped = dealIds.length - list.length;
    toast.success(`${list.length} ${deals(list.length)} moved to ${stage}${where}${skipped > 0 ? ` (${skipped} skipped by stage rules)` : ""}`);
    return list;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to bulk change stage"));
  }
});

export const bulkTagDeals = createAsyncThunk("crm/deals/bulkTag", async ({ dealIds, tag }, { rejectWithValue }) => {
  try {
    if (BACKEND) throw notSupported("Tagging");
    const { data } = await axiosInstance.post("/crm/deals/bulk/tag", { dealIds, tag });
    toast.success(`Tag added to ${data.deals.length} ${deals(data.deals.length)} in preview`);
    return data.deals;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to bulk tag"));
  }
});

export const bulkArchiveDeals = createAsyncThunk("crm/deals/bulkArchive", async ({ dealIds, reason }, { rejectWithValue }) => {
  try {
    const list = BACKEND ? await backendDeals.bulkArchive(dealIds, reason) : (await axiosInstance.post("/crm/deals/bulk/archive", { dealIds, reason })).data.deals;
    toast.success(`${list.length} ${deals(list.length)} archived${where}`);
    return list;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to bulk archive"));
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
