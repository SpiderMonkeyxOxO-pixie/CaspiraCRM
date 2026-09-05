import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";

// Re-exported from mockQuoteData for callers that import enums from this
// slice — mockQuoteData.js is the single source of truth for these lists.
export {
  QUOTE_STATUSES, EXPIRABLE_STATUSES, APPROVAL_STATUSES, DISCOUNT_TYPES, PAYMENT_TERMS_OPTIONS,
  BILLING_SCHEDULES, DOCUMENT_LAYOUTS, CUSTOMER_RESPONSE_TYPES, HANDOFF_ACTIONS,
  DISCOUNT_WARNING_THRESHOLD, EXPIRING_SOON_DAYS, TAX_RATE_PREVIEW,
} from "../../Helpers/mockQuoteData";

export const fetchQuotes = createAsyncThunk("sales/quotes/fetchAll", async (_, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/sales/quotes");
    return data.quotes;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load Quotes");
  }
});

export const fetchQuote = createAsyncThunk("sales/quotes/fetchOne", async (id, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get(`/sales/quotes/${id}`);
    return data.quote;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load the Quote");
  }
});

export const createQuote = createAsyncThunk("sales/quotes/create", async (payload, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post("/sales/quotes", payload);
    toast.promise(res, { loading: "Saving Quote...", success: "Quote saved", error: "Failed to save Quote" });
    const { data } = await res;
    return data.quote;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to save Quote" });
  }
});

export const updateQuote = createAsyncThunk("sales/quotes/update", async ({ id, changes }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.put(`/sales/quotes/${id}`, changes);
    return data.quote;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to update the Quote" });
  }
});

export const archiveQuote = createAsyncThunk("sales/quotes/archive", async ({ id, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to archive a Quote");
  try {
    const res = axiosInstance.post(`/sales/quotes/${id}/archive`, { reason });
    toast.promise(res, { loading: "Archiving...", success: "Quote archived", error: "Failed to archive Quote" });
    const { data } = await res;
    return data.quote;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to archive Quote");
  }
});

export const restoreQuote = createAsyncThunk("sales/quotes/restore", async (id, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/sales/quotes/${id}/restore`);
    toast.promise(res, { loading: "Restoring...", success: "Quote restored", error: "Failed to restore Quote" });
    const { data } = await res;
    return data.quote;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to restore Quote");
  }
});

export const bulkAssignOwner = createAsyncThunk("sales/quotes/bulkAssign", async ({ quoteIds, ownerId }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/sales/quotes/bulk/assign", { quoteIds, ownerId });
    toast.success(`${data.quotes.length} Quote(s) reassigned`);
    return data.quotes;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk assign");
  }
});

export const bulkArchiveQuotes = createAsyncThunk("sales/quotes/bulkArchive", async ({ quoteIds, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to archive");
  try {
    const { data } = await axiosInstance.post("/sales/quotes/bulk/archive", { quoteIds, reason });
    toast.success(`${data.quotes.length} Quote(s) archived`);
    return data.quotes;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk archive");
  }
});

export const submitForReview = createAsyncThunk("sales/quotes/submitReview", async (id, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/sales/quotes/${id}/submit-review`);
    toast.promise(res, { loading: "Submitting...", success: "Submitted for review", error: "Failed to submit" });
    const { data } = await res;
    return data.quote;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to submit for review");
  }
});

export const approveReview = createAsyncThunk("sales/quotes/approve", async ({ id, comment }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/sales/quotes/${id}/approve`, { comment });
    toast.promise(res, { loading: "Approving...", success: "Preview approved", error: "Failed to approve" });
    const { data } = await res;
    return data.quote;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to approve");
  }
});

export const rejectReview = createAsyncThunk("sales/quotes/reject", async ({ id, comment }, { rejectWithValue }) => {
  if (!comment?.trim()) return rejectWithValue("A comment is required to reject");
  try {
    const res = axiosInstance.post(`/sales/quotes/${id}/reject`, { comment });
    toast.promise(res, { loading: "Rejecting...", success: "Rejected", error: "Failed to reject" });
    const { data } = await res;
    return data.quote;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to reject");
  }
});

export const requestReviewChanges = createAsyncThunk("sales/quotes/requestChanges", async ({ id, comment }, { rejectWithValue }) => {
  if (!comment?.trim()) return rejectWithValue("A comment is required to request changes");
  try {
    const res = axiosInstance.post(`/sales/quotes/${id}/request-changes`, { comment });
    toast.promise(res, { loading: "Requesting changes...", success: "Changes requested", error: "Failed to request changes" });
    const { data } = await res;
    return data.quote;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to request changes");
  }
});

export const cancelQuote = createAsyncThunk("sales/quotes/cancel", async ({ id, reason }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/sales/quotes/${id}/cancel`, { reason });
    toast.promise(res, { loading: "Cancelling...", success: "Quote cancelled", error: "Failed to cancel" });
    const { data } = await res;
    return data.quote;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to cancel");
  }
});

export const previewSend = createAsyncThunk("sales/quotes/previewSend", async ({ id, ...body }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/sales/quotes/${id}/preview-send`, body);
    toast.promise(res, { loading: "Simulating send...", success: "Preview send simulated — no email was sent", error: "Failed to simulate send" });
    const { data } = await res;
    return data.quote;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to simulate send");
  }
});

export const simulateCustomerResponse = createAsyncThunk("sales/quotes/customerResponse", async ({ id, type, details }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/sales/quotes/${id}/customer-response`, { type, details });
    toast.promise(res, { loading: "Simulating response...", success: `Customer response simulated: ${type}`, error: "Failed to simulate response" });
    const { data } = await res;
    return data.quote;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to simulate response");
  }
});

export const createNewVersion = createAsyncThunk("sales/quotes/newVersion", async ({ id, payload }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/sales/quotes/${id}/new-version`, payload);
    toast.promise(res, { loading: "Creating new version...", success: "New version created", error: "Failed to create new version" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to create new version" });
  }
});

const initialState = {
  items: [],
  current: null,
  currentNotFound: false,
  loading: false,
  error: null,
};

const applyOne = (state, action) => {
  const updated = action.payload;
  if (!updated) return;
  state.items = state.items.map((q) => (q._id === updated._id ? updated : q));
  if (state.current?._id === updated._id) state.current = updated;
};

const applyMany = (state, action) => {
  const updated = action.payload || [];
  const byId = new Map(updated.map((q) => [q._id, q]));
  state.items = state.items.map((q) => byId.get(q._id) || q);
  if (state.current && byId.has(state.current._id)) state.current = byId.get(state.current._id);
};

const quotesSlice = createSlice({
  name: "quotes",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchQuotes.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchQuotes.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload || [];
      })
      .addCase(fetchQuotes.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchQuote.pending, (state) => {
        state.current = null;
        state.currentNotFound = false;
      })
      .addCase(fetchQuote.fulfilled, (state, action) => {
        state.current = action.payload;
        state.currentNotFound = false;
      })
      .addCase(fetchQuote.rejected, (state) => {
        // In-memory data resets on a full page reload — a bookmarked/shared
        // Quote URL can 404 in a fresh session.
        state.current = null;
        state.currentNotFound = true;
      })
      .addCase(createQuote.fulfilled, (state, action) => {
        if (action.payload) state.items.unshift(action.payload);
      })
      .addCase(createNewVersion.fulfilled, (state, action) => {
        const { quote, previous } = action.payload || {};
        if (quote) state.items.unshift(quote);
        if (previous) state.items = state.items.map((q) => (q._id === previous._id ? previous : q));
      })
      .addCase(bulkAssignOwner.fulfilled, applyMany)
      .addCase(bulkArchiveQuotes.fulfilled, applyMany);

    [
      updateQuote, archiveQuote, restoreQuote, submitForReview, approveReview, rejectReview,
      requestReviewChanges, cancelQuote, previewSend, simulateCustomerResponse,
    ].forEach((thunk) => builder.addCase(thunk.fulfilled, applyOne));
  },
});

export default quotesSlice.reducer;
