import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";

export const PROJECT_STATUSES = ["Planning", "Active", "On Hold", "Completed"];

export const fetchProjects = createAsyncThunk("projects/fetchAll", async (_, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/projects");
    return data.projects;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load projects");
  }
});

export const fetchProject = createAsyncThunk("projects/fetchOne", async (id, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get(`/projects/${id}`);
    return data.project;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load project");
  }
});

export const createProject = createAsyncThunk("projects/create", async (projectData, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post("/projects", projectData);
    toast.promise(res, { loading: "Creating project...", success: "Project created", error: "Failed to create project" });
    const { data } = await res;
    return data.project;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to create project");
  }
});

export const updateProject = createAsyncThunk("projects/update", async ({ id, changes }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.put(`/projects/${id}`, changes);
    return data.project;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to update project");
  }
});

export const addMilestone = createAsyncThunk(
  "projects/addMilestone",
  async ({ id, name, dueDate }, { rejectWithValue }) => {
    try {
      const { data } = await axiosInstance.post(`/projects/${id}/milestones`, { name, dueDate });
      return data.project;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to add milestone");
    }
  }
);

export const toggleMilestone = createAsyncThunk(
  "projects/toggleMilestone",
  async ({ id, milestoneId }, { rejectWithValue }) => {
    try {
      const { data } = await axiosInstance.put(`/projects/${id}/milestones/${milestoneId}`);
      return data.project;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to update milestone");
    }
  }
);

const applyUpdate = (state, action) => {
  const updated = action.payload;
  if (!updated) return;
  state.items = state.items.map((p) => (p._id === updated._id ? updated : p));
  if (state.current?._id === updated._id) state.current = updated;
};

const projectsSlice = createSlice({
  name: "projects",
  initialState: { items: [], current: null, loading: false, error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchProjects.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchProjects.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload || [];
      })
      .addCase(fetchProjects.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchProject.fulfilled, (state, action) => {
        state.current = action.payload;
      })
      .addCase(createProject.fulfilled, (state, action) => {
        if (action.payload) state.items.unshift(action.payload);
      });

    [updateProject, addMilestone, toggleMilestone].forEach((thunk) => builder.addCase(thunk.fulfilled, applyUpdate));
  },
});

export default projectsSlice.reducer;
