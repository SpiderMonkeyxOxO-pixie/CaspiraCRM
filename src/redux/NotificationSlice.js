import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axiosInstance from "../Helpers/axiosInstance";

export const fetchNotifications = createAsyncThunk(
  "notifications/fetchAll",
  async (userId, { rejectWithValue }) => {
    try {
      const res = await axiosInstance.get(`/notification/${userId}`);
      return res.data.notifications; // array of notifications
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to load notifications"
      );
    }
  }
);

// ==========================
// 2️⃣ MARK AS READ
// ==========================
export const markNotificationAsRead = createAsyncThunk(
  "notifications/markAsRead",
  async (notificationId, { rejectWithValue }) => {
    try {
      const res = await axiosInstance.put(
        `/notification/mark-as-read/${notificationId}`
      );
      return { id: notificationId, message: res.data.message };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to mark as read"
      );
    }
  }
);

// ==========================
// 3️⃣ CLEAR ALL (Local Action)
// ==========================
const notificationSlice = createSlice({
  name: "notifications",
  initialState: {
    notifications: [],
    unreadCount: 0,
    loading: false,
    error: null,
  },
  reducers: {
    clearNotifications: (state) => {
      state.notifications = [];
      state.unreadCount = 0;
    },
  },
  extraReducers: (builder) => {
    builder
      // 🔹 Fetch all
      .addCase(fetchNotifications.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchNotifications.fulfilled, (state, action) => {
        state.loading = false;
        state.notifications = action.payload || [];
        state.unreadCount = state.notifications.filter((n) => !n.isRead).length;
      })
      .addCase(fetchNotifications.rejected, (state, action) => {
        console.error("❌ Fetch failed:", action.payload);
        state.loading = false;
        state.error = action.payload;
      })

      // 🔹 Mark as read
      .addCase(markNotificationAsRead.fulfilled, (state, action) => {
        const { id } = action.payload;
        state.notifications = state.notifications.map((n) =>
          n._id === id ? { ...n, isRead: true } : n
        );
        state.unreadCount = Math.max(
          0,
          state.notifications.filter((n) => !n.isRead).length
        );
      })
      .addCase(markNotificationAsRead.rejected, (state, action) => {
        state.error = action.payload;
      });
  },
});

export const { clearNotifications } = notificationSlice.actions;
export default notificationSlice.reducer;
