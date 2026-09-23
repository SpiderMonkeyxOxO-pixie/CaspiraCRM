import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";
import * as backendFinance from "../../Helpers/financeBackend";

// VITE_BACKEND_FINANCE_MODE=true reads/writes invoices through the real
// /finance API (financeBackend.js); otherwise the mock layer.
const BACKEND = backendFinance.BACKEND_ENABLED;
const errorMessage = (error, fallback) => error.response?.data?.message || (BACKEND ? error.message : null) || fallback;

export const INVOICE_STATUSES = ["Draft", "Approved", "Sent", "Partially Paid", "Paid", "Overdue", "Void"];
export const APPROVAL_THRESHOLD = 10000; // invoices at/above this total need manager approval

export const fetchInvoices = createAsyncThunk("finance/invoices/fetchAll", async (_, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendFinance.listInvoices();
    const { data } = await axiosInstance.get("/finance/invoices");
    return data.invoices;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to load invoices"));
  }
});

export const fetchInvoice = createAsyncThunk("finance/invoices/fetchOne", async (id, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendFinance.getInvoice(id);
    const { data } = await axiosInstance.get(`/finance/invoices/${id}`);
    return data.invoice;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to load invoice"));
  }
});

export const createInvoice = createAsyncThunk("finance/invoices/create", async (invoiceData, { rejectWithValue }) => {
  try {
    const res = BACKEND ? backendFinance.createInvoice(invoiceData).then((invoice) => ({ data: { invoice } })) : axiosInstance.post("/finance/invoices", invoiceData);
    toast.promise(res, { loading: "Creating invoice...", success: "Invoice created", error: "Failed to create invoice" });
    const { data } = await res;
    return data.invoice;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to create invoice"));
  }
});

export const createInvoiceFromOrder = createAsyncThunk(
  "finance/invoices/createFromOrder",
  async (orderId, { rejectWithValue }) => {
    try {
      const res = BACKEND
        ? backendFinance.createInvoiceFromOrder(orderId).then((invoice) => ({ data: { invoice } }))
        : axiosInstance.post(`/sales/orders/${orderId}/invoice`);
      toast.promise(res, { loading: "Creating invoice...", success: "Invoice created", error: "Failed to create invoice" });
      const { data } = await res;
      return data.invoice;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to create invoice"));
    }
  }
);

export const approveInvoice = createAsyncThunk("finance/invoices/approve", async ({ id, approver }, { rejectWithValue }) => {
  try {
    const { data } = BACKEND
      ? { data: { invoice: await backendFinance.approveInvoice(id) } }
      : await axiosInstance.put(`/finance/invoices/${id}`, { status: "Approved", approvedBy: approver });
    toast.success("Invoice approved");
    return data.invoice;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to approve invoice"));
  }
});

export const markInvoiceSent = createAsyncThunk("finance/invoices/markSent", async (id, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendFinance.sendInvoice(id);
    const { data } = await axiosInstance.put(`/finance/invoices/${id}`, { status: "Sent" });
    return data.invoice;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to mark invoice as sent"));
  }
});

export const voidInvoice = createAsyncThunk("finance/invoices/void", async ({ id, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to void an invoice");
  try {
    const { data } = BACKEND
      ? { data: { invoice: await backendFinance.voidInvoice(id, reason) } }
      : await axiosInstance.put(`/finance/invoices/${id}`, { status: "Void", voidReason: reason });
    toast.success("Invoice voided");
    return data.invoice;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to void invoice"));
  }
});

export const recordPayment = createAsyncThunk(
  "finance/invoices/recordPayment",
  async ({ id, amount, method }, { rejectWithValue }) => {
    if (!amount || amount <= 0) return rejectWithValue("Enter a valid payment amount");
    try {
      const res = BACKEND
        ? backendFinance.recordPayment(id, amount, method).then((invoice) => ({ data: { invoice } }))
        : axiosInstance.post(`/finance/invoices/${id}/payments`, { amount, method });
      toast.promise(res, { loading: "Recording payment...", success: "Payment recorded", error: "Failed to record payment" });
      const { data } = await res;
      return data.invoice;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to record payment"));
    }
  }
);

const applyUpdate = (state, action) => {
  const updated = action.payload;
  if (!updated) return;
  state.items = state.items.map((i) => (i._id === updated._id ? updated : i));
  if (state.current?._id === updated._id) state.current = updated;
};

const invoicesSlice = createSlice({
  name: "invoices",
  initialState: { items: [], current: null, loading: false, error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchInvoices.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchInvoices.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload || [];
      })
      .addCase(fetchInvoices.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchInvoice.fulfilled, (state, action) => {
        state.current = action.payload;
      })
      .addCase(createInvoice.fulfilled, (state, action) => {
        if (action.payload) state.items.unshift(action.payload);
      })
      .addCase(createInvoiceFromOrder.fulfilled, (state, action) => {
        if (action.payload) state.items.unshift(action.payload);
      })
      .addCase(voidInvoice.rejected, (state, action) => {
        toast.error(action.payload || "Failed to void invoice");
      })
      .addCase(recordPayment.rejected, (state, action) => {
        toast.error(action.payload || "Failed to record payment");
      });

    [approveInvoice, markInvoiceSent, voidInvoice, recordPayment].forEach((thunk) => builder.addCase(thunk.fulfilled, applyUpdate));
    // Backend rules (e.g. approving your own large invoice) come back as a
    // message — show it rather than silently leaving the invoice unchanged.
    if (BACKEND) {
      [approveInvoice, markInvoiceSent].forEach((thunk) =>
        builder.addCase(thunk.rejected, (state, action) => {
          toast.error(action.payload || "Something went wrong");
        })
      );
    }
  },
});

export default invoicesSlice.reducer;
