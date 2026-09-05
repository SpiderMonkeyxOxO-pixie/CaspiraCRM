import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";

export const fetchTemplates = createAsyncThunk("marketing/templates/fetchAll", async (_, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/marketing/templates");
    return data.templates;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load templates");
  }
});

export const createTemplate = createAsyncThunk("marketing/templates/create", async (templateData, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post("/marketing/templates", templateData);
    toast.promise(res, { loading: "Saving template...", success: "Template saved", error: "Failed to save template" });
    const { data } = await res;
    return data.template;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to save template");
  }
});

const templatesSlice = createSlice({
  name: "templates",
  initialState: { items: [], loading: false, error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchTemplates.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchTemplates.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload || [];
      })
      .addCase(fetchTemplates.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(createTemplate.fulfilled, (state, action) => {
        if (action.payload) state.items.unshift(action.payload);
      });
  },
});

export default templatesSlice.reducer;
