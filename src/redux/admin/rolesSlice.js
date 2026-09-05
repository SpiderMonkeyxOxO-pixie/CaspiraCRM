import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";

// Re-exported from mockRbacData for callers that import RBAC catalog
// constants from this slice — mockRbacData.js is the single source of
// truth for these lists. This is a frontend-only RBAC preview: nothing
// here calls a real backend or changes production role/user assignments.
export {
  SCOPES, SCOPE_DESCRIPTIONS, ACTIONS, ACTION_LABELS, MODULE_GROUPS, FIELD_STATES,
  FIELD_STATE_LABELS, SENSITIVE_FIELD_GROUPS, APPROVAL_TYPES, SEPARATION_OF_DUTIES_RULES,
  HIGH_RISK_PERMISSIONS,
} from "../../Helpers/mockRbacData";

export const fetchRoles = createAsyncThunk("admin/roles/fetchAll", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/admin/roles", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load Roles");
  }
});

export const fetchRole = createAsyncThunk("admin/roles/fetchOne", async (id, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get(`/admin/roles/${id}`);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load the Role");
  }
});

export const createCustomRole = createAsyncThunk("admin/roles/create", async (payload, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post("/admin/roles", payload);
    toast.promise(res, { loading: "Saving Custom Role...", success: "Custom Role saved", error: "Failed to save Custom Role" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to save Custom Role" });
  }
});

export const updateCustomRole = createAsyncThunk("admin/roles/update", async ({ id, changes }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.put(`/admin/roles/${id}`, changes);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to update the Role" });
  }
});

export const duplicateRole = createAsyncThunk("admin/roles/duplicate", async ({ id, name }, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/admin/roles/${id}/duplicate`, { name });
    toast.promise(res, { loading: "Duplicating Role...", success: "Role duplicated into a new Custom Role", error: "Failed to duplicate Role" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to duplicate Role");
  }
});

export const archiveRole = createAsyncThunk("admin/roles/archive", async ({ id, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("An archive reason is required");
  try {
    const res = axiosInstance.post(`/admin/roles/${id}/archive`, { reason });
    toast.promise(res, { loading: "Archiving Role...", success: "Custom Role archived", error: "Failed to archive Role" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to archive Role");
  }
});

export const restoreRole = createAsyncThunk("admin/roles/restore", async (id, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/admin/roles/${id}/restore`);
    toast.promise(res, { loading: "Restoring Role...", success: "Custom Role restored", error: "Failed to restore Role" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to restore Role");
  }
});

export const disableRole = createAsyncThunk("admin/roles/disable", async (id, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/admin/roles/${id}/disable`);
    toast.promise(res, { loading: "Disabling Role...", success: "Custom Role disabled", error: "Failed to disable Role" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to disable Role");
  }
});

export const enableRole = createAsyncThunk("admin/roles/enable", async (id, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post(`/admin/roles/${id}/enable`);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to enable Role");
  }
});

export const compareRoles = createAsyncThunk("admin/roles/compare", async (roleIds, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/admin/roles/compare", { roleIds });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to compare Roles");
  }
});

export const fetchPermissionCatalog = createAsyncThunk("admin/permissions/fetchCatalog", async (_, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/admin/permissions/catalog");
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load the permission catalog");
  }
});

export const runAccessPreview = createAsyncThunk("admin/permissions/accessPreview", async (input, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/admin/permissions/access-preview", input);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to run the Access Preview");
  }
});

const initialState = {
  items: [],
  counts: null,
  current: null,
  currentNotFound: false,
  catalog: null,
  comparison: null,
  accessPreview: null,
  loading: false,
  error: null,
};

const applyOneRole = (state, action) => {
  const updated = action.payload?.role;
  if (!updated) return;
  state.items = state.items.map((r) => (r.id === updated.id ? updated : r));
  if (state.current?.role?.id === updated.id) state.current = { ...state.current, role: updated };
};

const rolesSlice = createSlice({
  name: "adminRoles",
  initialState,
  reducers: {
    clearAccessPreview(state) {
      state.accessPreview = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchRoles.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchRoles.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload?.roles || [];
        state.counts = action.payload?.counts || null;
      })
      .addCase(fetchRoles.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchRole.pending, (state) => {
        state.current = null;
        state.currentNotFound = false;
      })
      .addCase(fetchRole.fulfilled, (state, action) => {
        state.current = action.payload;
        state.currentNotFound = false;
      })
      .addCase(fetchRole.rejected, (state) => {
        // In-memory data resets on a full page reload — a bookmarked/shared
        // Role URL can 404 in a fresh session.
        state.current = null;
        state.currentNotFound = true;
      })
      .addCase(createCustomRole.fulfilled, (state, action) => {
        if (action.payload?.role) state.items.unshift(action.payload.role);
      })
      .addCase(duplicateRole.fulfilled, (state, action) => {
        if (action.payload?.role) state.items.unshift(action.payload.role);
      })
      .addCase(fetchPermissionCatalog.fulfilled, (state, action) => {
        state.catalog = action.payload;
      })
      .addCase(compareRoles.fulfilled, (state, action) => {
        state.comparison = action.payload;
      })
      .addCase(runAccessPreview.fulfilled, (state, action) => {
        state.accessPreview = action.payload;
      });

    [updateCustomRole, archiveRole, restoreRole, disableRole, enableRole].forEach((thunk) =>
      builder.addCase(thunk.fulfilled, applyOneRole)
    );
  },
});

export const { clearAccessPreview } = rolesSlice.actions;
export default rolesSlice.reducer;
