import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";

export const EXPENSE_CATEGORIES = ["Travel", "Software", "Office Supplies", "Meals", "Other"];
export const EXPENSE_STATUSES = ["Pending", "Approved", "Rejected"];

export const fetchExpenses = createAsyncThunk("finance/expenses/fetchAll", async (_, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/finance/expenses");
    return data.expenses;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load expenses");
  }
});

export const createExpense = createAsyncThunk("finance/expenses/create", async (expenseData, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post("/finance/expenses", expenseData);
    toast.promise(res, { loading: "Submitting expense...", success: "Expense submitted", error: "Failed to submit expense" });
    const { data } = await res;
    return data.expense;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to submit expense");
  }
});

export const reviewExpense = createAsyncThunk(
  "finance/expenses/review",
  async ({ id, status, reviewer }, { rejectWithValue }) => {
    try {
      const { data } = await axiosInstance.put(`/finance/expenses/${id}`, { status, reviewedBy: reviewer });
      toast.success(`Expense ${status.toLowerCase()}`);
      return data.expense;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to review expense");
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
  },
});

export default expensesSlice.reducer;
