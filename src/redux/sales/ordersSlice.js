import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";
import * as backendSales from "../../Helpers/crmOrdersContractsBackend";

// Re-exported from mockOrderData for callers that import enums from this
// slice — mockOrderData.js is the single source of truth for these lists.
export {
  ORDER_TYPES, ORDER_STATUSES, SETTABLE_STATUSES, PAYMENT_TERMS_OPTIONS, BILLING_SCHEDULES,
  DELIVERY_STATUSES, SETUP_STATUSES, ACTIVATION_STATUSES, DISCOUNT_TYPES, RELATED_RECORD_PREVIEWS,
  ORDER_PROGRESS_EXPLANATION,
} from "../../Helpers/mockOrderData";

// VITE_BACKEND_CRM_SALES_MODE=true reads/writes orders through the real
// backend (crmOrdersContractsBackend.js); otherwise the mock layer.
const BACKEND = backendSales.BACKEND_ENABLED;
const errorMessage = (error, fallback) => error.response?.data?.message || (BACKEND ? error.message : null) || fallback;
const errorBody = (error, fallback) => error.response?.data || { message: (BACKEND && error.message) || fallback };

export const fetchOrders = createAsyncThunk("sales/orders/fetchAll", async (_, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendSales.listOrders();
    const { data } = await axiosInstance.get("/sales/orders");
    return data.orders;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to load Orders"));
  }
});

export const fetchOrder = createAsyncThunk("sales/orders/fetchOne", async (id, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendSales.getOrder(id);
    const { data } = await axiosInstance.get(`/sales/orders/${id}`);
    return data.order;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to load the Order"));
  }
});

export const createOrder = createAsyncThunk("sales/orders/create", async (payload, { rejectWithValue }) => {
  try {
    const res = BACKEND ? backendSales.createOrder(payload).then((order) => ({ data: { order } })) : axiosInstance.post("/sales/orders", payload);
    toast.promise(res, { loading: "Saving Order...", success: "Order saved", error: "Failed to save Order" });
    const { data } = await res;
    return data.order;
  } catch (error) {
    return rejectWithValue(errorBody(error, "Failed to save Order"));
  }
});

export const updateOrder = createAsyncThunk("sales/orders/update", async ({ id, changes }, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendSales.updateOrder(id, changes);
    const { data } = await axiosInstance.put(`/sales/orders/${id}`, changes);
    return data.order;
  } catch (error) {
    return rejectWithValue(errorBody(error, "Failed to update the Order"));
  }
});

export const archiveOrder = createAsyncThunk("sales/orders/archive", async ({ id, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to archive an Order");
  try {
    const res = BACKEND ? backendSales.archiveOrder(id, reason).then((order) => ({ data: { order } })) : axiosInstance.post(`/sales/orders/${id}/archive`, { reason });
    toast.promise(res, { loading: "Archiving...", success: "Order archived", error: "Failed to archive Order" });
    const { data } = await res;
    return data.order;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to archive Order"));
  }
});

export const restoreOrder = createAsyncThunk("sales/orders/restore", async (id, { rejectWithValue }) => {
  try {
    const res = BACKEND ? backendSales.restoreOrder(id).then((order) => ({ data: { order } })) : axiosInstance.post(`/sales/orders/${id}/restore`);
    toast.promise(res, { loading: "Restoring...", success: "Order restored", error: "Failed to restore Order" });
    const { data } = await res;
    return data.order;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to restore Order"));
  }
});

export const bulkAssignOwner = createAsyncThunk("sales/orders/bulkAssign", async ({ orderIds, ownerId }, { rejectWithValue }) => {
  try {
    const orders = BACKEND
      ? await backendSales.bulkAssignOrders(orderIds, ownerId)
      : (await axiosInstance.post("/sales/orders/bulk/assign", { orderIds, ownerId })).data.orders;
    toast.success(`${orders.length} Order(s) reassigned`);
    return orders;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to bulk assign"));
  }
});

export const bulkArchiveOrders = createAsyncThunk("sales/orders/bulkArchive", async ({ orderIds, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to archive");
  try {
    const orders = BACKEND
      ? await backendSales.bulkArchiveOrders(orderIds, reason)
      : (await axiosInstance.post("/sales/orders/bulk/archive", { orderIds, reason })).data.orders;
    toast.success(`${orders.length} Order(s) archived`);
    return orders;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to bulk archive"));
  }
});

export const submitForReview = createAsyncThunk("sales/orders/submitReview", async (id, { rejectWithValue }) => {
  try {
    const res = BACKEND ? backendSales.submitOrderForReview(id).then((order) => ({ data: { order } })) : axiosInstance.post(`/sales/orders/${id}/submit-review`);
    toast.promise(res, { loading: "Submitting...", success: "Submitted for review", error: "Failed to submit" });
    const { data } = await res;
    return data.order;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to submit for review"));
  }
});

export const confirmOrder = createAsyncThunk("sales/orders/confirm", async ({ id, ...body }, { rejectWithValue }) => {
  try {
    const res = BACKEND ? backendSales.confirmOrder(id, body).then((order) => ({ data: { order } })) : axiosInstance.post(`/sales/orders/${id}/confirm`, body);
    toast.promise(res, { loading: "Confirming...", success: "Order confirmed", error: "Failed to confirm" });
    const { data } = await res;
    return data.order;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to confirm Order"));
  }
});

export const startProcessing = createAsyncThunk("sales/orders/startProcessing", async ({ id, ...body }, { rejectWithValue }) => {
  try {
    const res = BACKEND ? backendSales.startProcessing(id, body).then((order) => ({ data: { order } })) : axiosInstance.post(`/sales/orders/${id}/start-processing`, body);
    toast.promise(res, { loading: "Starting processing...", success: "Processing started", error: "Failed to start processing" });
    const { data } = await res;
    return data.order;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to start processing"));
  }
});

export const putOnHold = createAsyncThunk("sales/orders/hold", async ({ id, ...body }, { rejectWithValue }) => {
  if (!body.reason?.trim()) return rejectWithValue("A reason is required to put an Order on hold");
  try {
    const res = BACKEND ? backendSales.putOnHold(id, body).then((order) => ({ data: { order } })) : axiosInstance.post(`/sales/orders/${id}/hold`, body);
    toast.promise(res, { loading: "Updating...", success: "Order put on hold", error: "Failed to put on hold" });
    const { data } = await res;
    return data.order;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to put on hold"));
  }
});

export const resumeOrder = createAsyncThunk("sales/orders/resume", async ({ id, ...body }, { rejectWithValue }) => {
  try {
    const res = BACKEND ? backendSales.resumeOrder(id, body).then((order) => ({ data: { order } })) : axiosInstance.post(`/sales/orders/${id}/resume`, body);
    toast.promise(res, { loading: "Resuming...", success: "Order resumed", error: "Failed to resume" });
    const { data } = await res;
    return data.order;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to resume Order"));
  }
});

export const cancelOrder = createAsyncThunk("sales/orders/cancel", async ({ id, ...body }, { rejectWithValue }) => {
  if (!body.reason?.trim()) return rejectWithValue("A cancellation reason is required");
  try {
    const res = BACKEND ? backendSales.cancelOrder(id, body).then((order) => ({ data: { order } })) : axiosInstance.post(`/sales/orders/${id}/cancel`, body);
    toast.promise(res, { loading: "Cancelling...", success: "Order cancelled", error: "Failed to cancel" });
    const { data } = await res;
    return data.order;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to cancel Order"));
  }
});

export const markFulfilled = createAsyncThunk("sales/orders/fulfilled", async (id, { rejectWithValue }) => {
  try {
    const res = BACKEND ? backendSales.markFulfilled(id).then((order) => ({ data: { order } })) : axiosInstance.post(`/sales/orders/${id}/fulfilled`);
    toast.promise(res, { loading: "Updating...", success: "Order marked fulfilled", error: "Failed to update" });
    const { data } = await res;
    return data.order;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to mark fulfilled"));
  }
});

export const markCompleted = createAsyncThunk("sales/orders/complete", async ({ id, ...body }, { rejectWithValue }) => {
  try {
    const res = BACKEND ? backendSales.markCompleted(id).then((order) => ({ data: { order } })) : axiosInstance.post(`/sales/orders/${id}/complete`, body);
    toast.promise(res, { loading: "Completing...", success: "Order completed", error: "Failed to complete" });
    const { data } = await res;
    return data.order;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to complete Order"));
  }
});

export const requestInvoicePreview = createAsyncThunk("sales/orders/requestInvoicePreview", async (id, { rejectWithValue }) => {
  try {
    const res = BACKEND ? backendSales.requestInvoice(id).then((order) => ({ data: { order } })) : axiosInstance.post(`/sales/orders/${id}/request-invoice-preview`);
    toast.promise(res, BACKEND
      ? { loading: "Requesting invoice...", success: "Draft invoice created in Finance", error: "Failed to request the invoice" }
      : { loading: "Previewing...", success: "Invoice request previewed — no Invoice was created", error: "Failed to preview" });
    const { data } = await res;
    return data.order;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to preview invoice request"));
  }
});

export const updateLineFulfillment = createAsyncThunk("sales/orders/lineFulfillment", async ({ id, lineId, ...body }, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendSales.updateLineFulfillment(id, lineId, body);
    const { data } = await axiosInstance.post(`/sales/orders/${id}/lines/${lineId}/fulfillment`, body);
    return data.order;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to update fulfillment"));
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
  state.items = state.items.map((o) => (o._id === updated._id ? updated : o));
  if (state.current?._id === updated._id) state.current = updated;
};
const applyMany = (state, action) => {
  const updated = action.payload || [];
  const byId = new Map(updated.map((o) => [o._id, o]));
  state.items = state.items.map((o) => byId.get(o._id) || o);
  if (state.current && byId.has(state.current._id)) state.current = byId.get(state.current._id);
};

const ordersSlice = createSlice({
  name: "orders",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchOrders.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchOrders.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload || [];
      })
      .addCase(fetchOrders.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchOrder.pending, (state) => {
        state.current = null;
        state.currentNotFound = false;
      })
      .addCase(fetchOrder.fulfilled, (state, action) => {
        state.current = action.payload;
        state.currentNotFound = false;
      })
      .addCase(fetchOrder.rejected, (state) => {
        // In-memory data resets on a full page reload — a bookmarked/shared
        // Order URL can 404 in a fresh session.
        state.current = null;
        state.currentNotFound = true;
      })
      .addCase(createOrder.fulfilled, (state, action) => {
        if (action.payload) state.items.unshift(action.payload);
      })
      .addCase(bulkAssignOwner.fulfilled, applyMany)
      .addCase(bulkArchiveOrders.fulfilled, applyMany);

    [
      updateOrder, archiveOrder, restoreOrder, submitForReview, confirmOrder, startProcessing, putOnHold,
      resumeOrder, cancelOrder, markFulfilled, markCompleted, requestInvoicePreview, updateLineFulfillment,
    ].forEach((thunk) => builder.addCase(thunk.fulfilled, applyOne));
  },
});

export default ordersSlice.reducer;
