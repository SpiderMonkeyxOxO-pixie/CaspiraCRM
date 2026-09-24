import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";
import * as backendFinance from "../../Helpers/financeBackend";

// VITE_BACKEND_FINANCE_MODE=true reads/writes expenses through the real
// /finance API (financeBackend.js); otherwise the mock layer.
const BACKEND = backendFinance.BACKEND_ENABLED;
const errorMessage = (error, fallback) => error.response?.data?.message || (BACKEND ? error.message : null) || fallback;

export const EXPENSE_CATEGORIES = ["Travel", "Software", "Office Supplies", "Meals", "Other"];
// Backend mode adds Draft, Posted, Reimbursed Record (recorded, not paid) and Cancelled.
export const EXPENSE_STATUSES = ["Draft", "Pending", "Approved", "Rejected", "Posted", "Reimbursed Record", "Cancelled"];

export const fetchExpenses = createAsyncThunk("finance/expenses/fetchAll", async (_, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendFinance.listExpenses();
    const { data } = await axiosInstance.get("/finance/expenses");
    return data.expenses;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to load expenses"));
  }
});

export const createExpense = createAsyncThunk("finance/expenses/create", async (expenseData, { rejectWithValue }) => {
  try {
    const res = BACKEND ? backendFinance.createExpense(expenseData).then((expense) => ({ data: { expense } })) : axiosInstance.post("/finance/expenses", expenseData);
    toast.promise(res, { loading: "Submitting expense...", success: "Expense submitted", error: "Failed to submit expense" });
    const { data } = await res;
    return data.expense;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to submit expense"));
  }
});

export const reviewExpense = createAsyncThunk(
  "finance/expenses/review",
  async ({ id, status, reviewer }, { rejectWithValue }) => {
    try {
      const { data } = BACKEND
        ? { data: { expense: await backendFinance.reviewExpense(id, status) } }
        : await axiosInstance.put(`/finance/expenses/${id}`, { status, reviewedBy: reviewer });
      toast.success(`Expense ${status.toLowerCase()}`);
      return data.expense;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to review expense"));
    }
  }
);

const expensesSlice = createSlice({
  name: "expenses",
  initialState: { items: [], loading: false, error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchExpenses.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchExpenses.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload || [];
      })
      .addCase(fetchExpenses.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(createExpense.fulfilled, (state, action) => {
        if (action.payload) state.items.unshift(action.payload);
      })
      .addCase(reviewExpense.fulfilled, (state, action) => {
        const updated = action.payload;
        if (!updated) return;
        state.items = state.items.map((e) => (e._id === updated._id ? updated : e));
      });
    // Backend rules (e.g. reviewing your own expense) come back as a message.
    if (BACKEND) {
      builder.addCase(reviewExpense.rejected, (state, action) => {
        toast.error(action.payload || "Failed to review expense");
      });
    }
  },
});

export default expensesSlice.reducer;
