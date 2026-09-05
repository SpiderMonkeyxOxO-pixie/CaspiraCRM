import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";

export const SEGMENT_FIELDS = [
  { field: "industry", label: "Company Industry" },
  { field: "accountType", label: "Company Account Type" },
];

export const fetchSegments = createAsyncThunk("marketing/segments/fetchAll", async (_, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/marketing/segments");
    return data.segments;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load segments");
  }
});

export const createSegment = createAsyncThunk("marketing/segments/create", async (segmentData, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post("/marketing/segments", segmentData);
    toast.promise(res, { loading: "Creating segment...", success: "Segment created", error: "Failed to create segment" });
    const { data } = await res;
    return data.segment;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to create segment");
  }
});

export const deleteSegment = createAsyncThunk("marketing/segments/delete", async (id, { rejectWithValue }) => {
  try {
    await axiosInstance.delete(`/marketing/segments/${id}`);
    return id;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to delete segment");
  }
});

const segmentsSlice = createSlice({
  name: "segments",
  initialState: { items: [], loading: false, error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchSegments.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchSegments.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload || [];
      })
      .addCase(fetchSegments.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(createSegment.fulfilled, (state, action) => {
        if (action.payload) state.items.unshift(action.payload);
      })
      .addCase(deleteSegment.fulfilled, (state, action) => {
        state.items = state.items.filter((s) => s._id !== action.payload);
      });
  },
});

export default segmentsSlice.reducer;
