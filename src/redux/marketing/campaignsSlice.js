import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";

export const CAMPAIGN_CHANNELS = ["Email", "Social", "Search", "Event", "Referral"];
export const CAMPAIGN_STATUSES = ["Draft", "Active", "Paused", "Completed"];

export const fetchCampaigns = createAsyncThunk("marketing/campaigns/fetchAll", async (_, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/marketing/campaigns");
    return data.campaigns;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load campaigns");
  }
});

export const fetchCampaign = createAsyncThunk("marketing/campaigns/fetchOne", async (id, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get(`/marketing/campaigns/${id}`);
    return data.campaign;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load campaign");
  }
});

export const createCampaign = createAsyncThunk("marketing/campaigns/create", async (campaignData, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post("/marketing/campaigns", campaignData);
    toast.promise(res, { loading: "Creating campaign...", success: "Campaign created", error: "Failed to create campaign" });
    const { data } = await res;
    return data.campaign;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to create campaign");
  }
});

export const updateCampaignStatus = createAsyncThunk(
  "marketing/campaigns/updateStatus",
  async ({ id, status }, { rejectWithValue }) => {
    try {
      const { data } = await axiosInstance.put(`/marketing/campaigns/${id}`, { status });
      return data.campaign;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to update campaign");
    }
  }
);

const campaignsSlice = createSlice({
  name: "campaigns",
  initialState: { items: [], current: null, loading: false, error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchCampaigns.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchCampaigns.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload || [];
      })
      .addCase(fetchCampaigns.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchCampaign.fulfilled, (state, action) => {
        state.current = action.payload;
      })
      .addCase(createCampaign.fulfilled, (state, action) => {
        if (action.payload) state.items.unshift(action.payload);
      })
      .addCase(updateCampaignStatus.fulfilled, (state, action) => {
        const updated = action.payload;
        if (!updated) return;
        state.items = state.items.map((c) => (c._id === updated._id ? updated : c));
        if (state.current?._id === updated._id) state.current = updated;
      });
  },
});

export default campaignsSlice.reducer;
