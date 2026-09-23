import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";
import * as backendFinance from "../../Helpers/financeBackend";

// VITE_BACKEND_FINANCE_MODE=true reads/writes recurring invoices through the real
// /finance API (financeBackend.js); otherwise the mock layer.
const BACKEND = backendFinance.BACKEND_ENABLED;
const errorMessage = (error, fallback) => error.response?.data?.message || (BACKEND ? error.message : null) || fallback;

export const RECURRING_INTERVALS = ["Weekly", "Monthly", "Quarterly", "Annually"];

export const fetchRecurringInvoices = createAsyncThunk("finance/recurring/fetchAll", async (_, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendFinance.listRecurringInvoices();
    const { data } = await axiosInstance.get("/finance/recurring-invoices");
    return data.recurringInvoices;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to load recurring invoices"));
  }
});

export const createRecurringInvoice = createAsyncThunk(
  "finance/recurring/create",
  async (payload, { rejectWithValue }) => {
    try {
      const res = BACKEND
        ? backendFinance.createRecurringInvoice(payload).then((recurringInvoice) => ({ data: { recurringInvoice } }))
        : axiosInstance.post("/finance/recurring-invoices", payload);
      toast.promise(res, { loading: "Setting up recurring invoice...", success: "Recurring invoice created", error: "Failed to create recurring invoice" });
      const { data } = await res;
      return data.recurringInvoice;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to create recurring invoice"));
    }
  }
);

export const toggleRecurringInvoice = createAsyncThunk(
  "finance/recurring/toggle",
  async ({ id, active }, { rejectWithValue }) => {
    try {
      if (BACKEND) return await backendFinance.toggleRecurringInvoice(id, active);
      const { data } = await axiosInstance.put(`/finance/recurring-invoices/${id}`, { active });
      return data.recurringInvoice;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to update recurring invoice"));
    }
  }
);

export const generateNextInvoice = createAsyncThunk(
  "finance/recurring/generateNext",
  async (id, { rejectWithValue }) => {
    try {
      const res = BACKEND
        ? backendFinance.generateNextInvoice(id).then((data) => ({ data }))
        : axiosInstance.post(`/finance/recurring-invoices/${id}/generate`);
      toast.promise(res, { loading: "Generating invoice...", success: "Invoice generated", error: "Failed to generate invoice" });
      const { data } = await res;
      return data;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to generate invoice"));
    }
  }
);

const recurringInvoicesSlice = createSlice({
  name: "recurringInvoices",
  initialState: { items: [], loading: false, error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchRecurringInvoices.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchRecurringInvoices.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload || [];
      })
      .addCase(fetchRecurringInvoices.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(createRecurringInvoice.fulfilled, (state, action) => {
        if (action.payload) state.items.unshift(action.payload);
      });

    [toggleRecurringInvoice, generateNextInvoice].forEach((thunk) => {
      builder.addCase(thunk.fulfilled, (state, action) => {
        const updated = action.payload?.recurringInvoice || action.payload;
        if (!updated?._id) return;
        state.items = state.items.map((r) => (r._id === updated._id ? updated : r));
      });
    });
    // Backend rules (e.g. generating from a paused template) come back as a message.
    if (BACKEND) {
      builder.addCase(toggleRecurringInvoice.rejected, (state, action) => {
        toast.error(action.payload || "Failed to update recurring invoice");
      });
    }
  },
});

export default recurringInvoicesSlice.reducer;
