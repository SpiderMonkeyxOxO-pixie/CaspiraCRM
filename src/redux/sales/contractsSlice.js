import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";

// Re-exported from mockContractData for callers that import enums from this
// slice — mockContractData.js is the single source of truth for these lists.
export {
  CONTRACT_TYPES, CONTRACT_STATUSES, SETTABLE_STATUSES, RENEWAL_TYPES, PAYMENT_TERMS_OPTIONS,
  BILLING_SCHEDULES, DISCOUNT_TYPES, RELATED_RECORD_PREVIEWS, RENEWAL_NOTICE_DAYS_DEFAULT, EXPIRING_SOON_DAYS,
} from "../../Helpers/mockContractData";

export const fetchContracts = createAsyncThunk("sales/contracts/fetchAll", async (_, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/sales/contracts");
    return data.contracts;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load Contracts");
  }
});

export const fetchContract = createAsyncThunk("sales/contracts/fetchOne", async (id, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get(`/sales/contracts/${id}`);
    return data.contract;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load the Contract");
  }
});

export const createContract = createAsyncThunk("sales/contracts/create", async (payload, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post("/sales/contracts", payload);
    toast.promise(res, { loading: "Saving Contract...", success: "Contract saved", error: "Failed to save Contract" });
    const { data } = await res;
    return data.contract;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to save Contract" });
  }
});

export const updateContract = createAsyncThunk("sales/contracts/update", async ({ id, changes }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.put(`/sales/contracts/${id}`, changes);
    return data.contract;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to update the Contract" });
  }
});

export const archiveContract = createAsyncThunk("sales/contracts/archive", async ({ id, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to archive a Contract");
  try {
    const res = axiosInstance.post(`/sales/contracts/${id}/archive`, { reason });
    toast.promise(res, { loading: "Archiving...", success: "Contract archived", error: "Failed to archive Contract" });
    const { data } = await res;
    return data.contract;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to archive Contract");
  }
});

export const restoreContract = createAsyncThunk("sales/contracts/restore", async (id, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/sales/contracts/${id}/restore`);
    toast.promise(res, { loading: "Restoring...", success: "Contract restored", error: "Failed to restore Contract" });
    const { data } = await res;
    return data.contract;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to restore Contract");
  }
});

export const bulkAssignOwner = createAsyncThunk("sales/contracts/bulkAssign", async ({ contractIds, ownerId }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/sales/contracts/bulk/assign", { contractIds, ownerId });
    toast.success(`${data.contracts.length} Contract(s) reassigned`);
    return data.contracts;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk assign");
  }
});

export const bulkArchiveContracts = createAsyncThunk("sales/contracts/bulkArchive", async ({ contractIds, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to archive");
  try {
    const res = axiosInstance.post("/sales/contracts/bulk/archive", { contractIds, reason });
    toast.promise(res, { loading: "Archiving...", success: "Contracts archived", error: "Failed to bulk archive" });
    const { data } = await res;
    return data.contracts;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk archive");
  }
});

export const submitForInternalReview = createAsyncThunk("sales/contracts/submitReview", async (id, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post(`/sales/contracts/${id}/submit-review`);
    return data.contract;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to submit for review");
  }
});

export const sendForSignature = createAsyncThunk("sales/contracts/sendForSignature", async ({ id, ...body }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/sales/contracts/${id}/send-for-signature`, body);
    toast.promise(res, { loading: "Sending...", success: "Contract sent for signature", error: "Failed to send for signature" });
    const { data } = await res;
    return data.contract;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to send for signature");
  }
});

export const recordSignature = createAsyncThunk("sales/contracts/recordSignature", async ({ id, ...body }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/sales/contracts/${id}/record-signature`, body);
    toast.promise(res, { loading: "Recording signature...", success: "Signature recorded", error: "Failed to record signature" });
    const { data } = await res;
    return data.contract;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to record signature");
  }
});

export const renewContract = createAsyncThunk("sales/contracts/renew", async ({ id, ...body }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/sales/contracts/${id}/renew`, body);
    toast.promise(res, { loading: "Renewing...", success: "Contract renewed", error: "Failed to renew Contract" });
    const { data } = await res;
    return data.contract;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to renew Contract");
  }
});

export const terminateContract = createAsyncThunk("sales/contracts/terminate", async ({ id, ...body }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/sales/contracts/${id}/terminate`, body);
    toast.promise(res, { loading: "Terminating...", success: "Contract terminated", error: "Failed to terminate Contract" });
    const { data } = await res;
    return data.contract;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to terminate Contract");
  }
});

export const cancelContract = createAsyncThunk("sales/contracts/cancel", async ({ id, ...body }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/sales/contracts/${id}/cancel`, body);
    toast.promise(res, { loading: "Cancelling...", success: "Contract cancelled", error: "Failed to cancel Contract" });
    const { data } = await res;
    return data.contract;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to cancel Contract");
  }
});

export const expireContract = createAsyncThunk("sales/contracts/expire", async (id, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post(`/sales/contracts/${id}/expire`);
    return data.contract;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to mark expired");
  }
});

const initialState = { items: [], current: null, currentNotFound: false, loading: false, error: null };

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

const contractsSlice = createSlice({
  name: "contracts",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchContracts.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchContracts.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload || [];
      })
      .addCase(fetchContracts.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchContract.pending, (state) => {
        state.current = null;
        state.currentNotFound = false;
      })
      .addCase(fetchContract.fulfilled, (state, action) => {
        state.current = action.payload;
        state.currentNotFound = false;
      })
      .addCase(fetchContract.rejected, (state) => {
        // In-memory data resets on a full page reload — a bookmarked/shared
        // Contract URL can 404 in a fresh session.
        state.current = null;
        state.currentNotFound = true;
      })
      .addCase(createContract.fulfilled, (state, action) => {
        if (action.payload) state.items.unshift(action.payload);
      })
      .addCase(bulkAssignOwner.fulfilled, applyMany)
      .addCase(bulkArchiveContracts.fulfilled, applyMany);

    [
      updateContract, archiveContract, restoreContract, submitForInternalReview, sendForSignature,
      recordSignature, renewContract, terminateContract, cancelContract, expireContract,
    ].forEach((thunk) => builder.addCase(thunk.fulfilled, applyOne));
  },
});

export default contractsSlice.reducer;
