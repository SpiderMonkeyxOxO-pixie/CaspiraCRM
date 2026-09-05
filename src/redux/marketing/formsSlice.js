import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";

export const fetchForms = createAsyncThunk("marketing/forms/fetchAll", async (_, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/marketing/forms");
    return data.forms;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load forms");
  }
});

export const createForm = createAsyncThunk("marketing/forms/create", async (formData, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post("/marketing/forms", formData);
    toast.promise(res, { loading: "Creating form...", success: "Form created", error: "Failed to create form" });
    const { data } = await res;
    return data.form;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to create form");
  }
});

// Simulates a real visitor submitting the lead-capture form: creates an
// actual CRM lead tagged with this form's campaign/source for attribution.
export const submitFormLead = createAsyncThunk(
  "marketing/forms/submitLead",
  async ({ id, leadData }, { rejectWithValue }) => {
    try {
      const res = axiosInstance.post(`/marketing/forms/${id}/submit`, leadData);
      toast.promise(res, { loading: "Submitting...", success: "Lead captured in CRM", error: "Failed to submit form" });
      const { data } = await res;
      return data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to submit form");
    }
  }
);

const formsSlice = createSlice({
  name: "forms",
  initialState: { items: [], loading: false, error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchForms.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchForms.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload || [];
      })
      .addCase(fetchForms.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(createForm.fulfilled, (state, action) => {
        if (action.payload) state.items.unshift(action.payload);
      })
      .addCase(submitFormLead.fulfilled, (state, action) => {
        const { form } = action.payload || {};
        if (!form) return;
        state.items = state.items.map((f) => (f._id === form._id ? form : f));
      });
  },
});

export default formsSlice.reducer;
