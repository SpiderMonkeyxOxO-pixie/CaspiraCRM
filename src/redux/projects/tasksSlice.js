import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";

export const TASK_STATUSES = ["To Do", "In Progress", "Review", "Done"];
export const TASK_PRIORITIES = ["Low", "Medium", "High", "Urgent"];

export const fetchTasks = createAsyncThunk("tasks/fetchAll", async (_, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/tasks");
    return data.tasks;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load tasks");
  }
});

export const createTask = createAsyncThunk("tasks/create", async (taskData, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post("/tasks", taskData);
    toast.promise(res, { loading: "Creating task...", success: "Task created", error: "Failed to create task" });
    const { data } = await res;
    return data.task;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to create task");
  }
});

export const updateTaskStatus = createAsyncThunk(
  "tasks/updateStatus",
  async ({ id, status }, { rejectWithValue }) => {
    try {
      const { data } = await axiosInstance.put(`/tasks/${id}`, { status });
      return data.task;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to update task");
    }
  }
);

export const updateTask = createAsyncThunk("tasks/update", async ({ id, changes }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.put(`/tasks/${id}`, changes);
    return data.task;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to update task");
  }
});

export const addTaskComment = createAsyncThunk(
  "tasks/addComment",
  async ({ id, message, author }, { rejectWithValue }) => {
    if (!message?.trim()) return rejectWithValue("Comment cannot be empty");
    try {
      const { data } = await axiosInstance.post(`/tasks/${id}/comments`, { message, author });
      return data.task;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to add comment");
    }
  }
);

export const logTime = createAsyncThunk("tasks/logTime", async ({ id, hours, note, author }, { rejectWithValue }) => {
  if (!hours || hours <= 0) return rejectWithValue("Enter a valid number of hours");
  try {
    const res = axiosInstance.post(`/tasks/${id}/time`, { hours, note, author });
    toast.promise(res, { loading: "Logging time...", success: "Time logged", error: "Failed to log time" });
    const { data } = await res;
    return data.task;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to log time");
  }
});

const applyUpdate = (state, action) => {
  const updated = action.payload;
  if (!updated) return;
  state.items = state.items.map((t) => (t._id === updated._id ? updated : t));
};

const tasksSlice = createSlice({
  name: "tasks",
  initialState: { items: [], loading: false, error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchTasks.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchTasks.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload || [];
      })
      .addCase(fetchTasks.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(createTask.fulfilled, (state, action) => {
        if (action.payload) state.items.unshift(action.payload);
      })
      .addCase(logTime.rejected, (state, action) => {
        toast.error(action.payload || "Failed to log time");
      })
      .addCase(addTaskComment.rejected, (state, action) => {
        toast.error(action.payload || "Failed to add comment");
      });

    [updateTaskStatus, updateTask, addTaskComment, logTime].forEach((thunk) => builder.addCase(thunk.fulfilled, applyUpdate));
  },
});

export default tasksSlice.reducer;
