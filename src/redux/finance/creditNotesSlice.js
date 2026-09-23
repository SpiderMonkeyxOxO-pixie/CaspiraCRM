import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";
import * as backendFinance from "../../Helpers/financeBackend";

// VITE_BACKEND_FINANCE_MODE=true reads/writes credit notes through the real
// /finance API (financeBackend.js); otherwise the mock layer.
const BACKEND = backendFinance.BACKEND_ENABLED;
const errorMessage = (error, fallback) => error.response?.data?.message || (BACKEND ? error.message : null) || fallback;

export const fetchCreditNotes = createAsyncThunk("finance/creditNotes/fetchAll", async (_, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendFinance.listCreditNotes();
    const { data } = await axiosInstance.get("/finance/credit-notes");
    return data.creditNotes;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to load credit notes"));
  }
});

export const createCreditNote = createAsyncThunk(
  "finance/creditNotes/create",
  async ({ invoiceId, amount, reason }, { rejectWithValue }) => {
    if (!reason?.trim()) return rejectWithValue("A reason is required for a credit note");
    try {
      const res = BACKEND
        ? backendFinance.issueCreditNote({ invoiceId, amount, reason }).then((data) => ({ data }))
        : axiosInstance.post("/finance/credit-notes", { invoiceId, amount, reason });
      toast.promise(res, { loading: "Issuing credit note...", success: "Credit note issued", error: "Failed to issue credit note" });
      const { data } = await res;
      return data;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to issue credit note"));
    }
  }
);

const creditNotesSlice = createSlice({
  name: "creditNotes",
  initialState: { items: [], loading: false, error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchCreditNotes.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchCreditNotes.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload || [];
      })
      .addCase(fetchCreditNotes.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(createCreditNote.fulfilled, (state, action) => {
        const { creditNote } = action.payload || {};
        if (creditNote) state.items.unshift(creditNote);
      })
      .addCase(createCreditNote.rejected, (state, action) => {
        toast.error(action.payload || "Failed to issue credit note");
      });
  },
});

export default creditNotesSlice.reducer;
