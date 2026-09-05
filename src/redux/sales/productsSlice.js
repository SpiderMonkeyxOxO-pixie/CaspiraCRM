import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";

// Re-exported from mockCatalogData for callers that import enums from this
// slice — mockCatalogData.js is the single source of truth for these lists.
export {
  CATALOG_TYPES, CATALOG_STATUSES, BILLING_MODELS, BILLING_INTERVALS, CATALOG_CURRENCIES,
  CATALOG_CATEGORIES, TAX_CATEGORIES, USAGE_BILLING_UNITS, CATALOG_UNITS, PRICE_TREATMENTS,
  RENEWAL_BEHAVIORS, DRAFT_ATTENTION_DAYS,
} from "../../Helpers/mockCatalogData";

// Deliberately NOT server-shaped/paginated — same pattern as Companies:
// the whole catalog is fetched once and ProductsList filters/sorts/
// paginates client-side via queryCatalogLocal().
export const fetchProducts = createAsyncThunk("sales/products/fetchAll", async (_, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/sales/products");
    return data.products;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load the catalog");
  }
});

export const fetchProduct = createAsyncThunk("sales/products/fetchOne", async (id, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get(`/sales/products/${id}`);
    return data.product;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load the catalog item");
  }
});

export const createProduct = createAsyncThunk("sales/products/create", async (payload, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post("/sales/products", payload);
    toast.promise(res, { loading: "Adding catalog item...", success: "Catalog item added", error: "Failed to add catalog item" });
    const { data } = await res;
    return data.product;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to add catalog item" });
  }
});

export const updateProduct = createAsyncThunk("sales/products/update", async ({ id, changes }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.put(`/sales/products/${id}`, changes);
    return data.product;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to update catalog item" });
  }
});

export const archiveProduct = createAsyncThunk("sales/products/archive", async ({ id, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to archive a catalog item");
  try {
    const res = axiosInstance.post(`/sales/products/${id}/archive`, { reason });
    toast.promise(res, { loading: "Archiving...", success: "Catalog item archived", error: "Failed to archive catalog item" });
    const { data } = await res;
    return data.product;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to archive catalog item");
  }
});

export const restoreProduct = createAsyncThunk("sales/products/restore", async (id, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/sales/products/${id}/restore`);
    toast.promise(res, { loading: "Restoring...", success: "Catalog item restored", error: "Failed to restore catalog item" });
    const { data } = await res;
    return data.product;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to restore catalog item");
  }
});

export const bulkAssignOwner = createAsyncThunk("sales/products/bulkAssign", async ({ itemIds, ownerId }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/sales/products/bulk/assign", { itemIds, ownerId });
    toast.success(`${data.products.length} item(s) reassigned`);
    return data.products;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk assign");
  }
});

export const bulkChangeCategory = createAsyncThunk("sales/products/bulkCategory", async ({ itemIds, category }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/sales/products/bulk/category", { itemIds, category });
    toast.success(`${data.products.length} item(s) recategorized`);
    return data.products;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk change category");
  }
});

export const bulkChangeStatus = createAsyncThunk("sales/products/bulkStatus", async ({ itemIds, status }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/sales/products/bulk/status", { itemIds, status });
    toast.success(`${data.products.length} item(s) updated`);
    return data.products;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk change status");
  }
});

export const bulkTagProducts = createAsyncThunk("sales/products/bulkTag", async ({ itemIds, tag }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/sales/products/bulk/tag", { itemIds, tag });
    toast.success(`Tag added to ${data.products.length} item(s)`);
    return data.products;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk tag");
  }
});

export const bulkArchiveProducts = createAsyncThunk("sales/products/bulkArchive", async ({ itemIds, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to archive");
  try {
    const { data } = await axiosInstance.post("/sales/products/bulk/archive", { itemIds, reason });
    toast.success(`${data.products.length} item(s) archived`);
    return data.products;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to bulk archive");
  }
});

const initialState = {
  items: [],
  current: null,
  currentNotFound: false,
  loading: false,
  error: null,
};

const applyOne = (state, action) => {
  const updated = action.payload;
  if (!updated) return;
  state.items = state.items.map((p) => (p._id === updated._id ? updated : p));
  if (state.current?._id === updated._id) state.current = updated;
};

const applyMany = (state, action) => {
  const updated = action.payload || [];
  const byId = new Map(updated.map((p) => [p._id, p]));
  state.items = state.items.map((p) => byId.get(p._id) || p);
  if (state.current && byId.has(state.current._id)) state.current = byId.get(state.current._id);
};

const productsSlice = createSlice({
  name: "products",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchProducts.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchProducts.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload || [];
      })
      .addCase(fetchProducts.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchProduct.pending, (state) => {
        state.current = null;
        state.currentNotFound = false;
      })
      .addCase(fetchProduct.fulfilled, (state, action) => {
        state.current = action.payload;
        state.currentNotFound = false;
      })
      .addCase(fetchProduct.rejected, (state) => {
        // Mock data lives only in memory and is reseeded on every full page
        // load, so a bookmarked/shared catalog-item URL frequently 404s.
        state.current = null;
        state.currentNotFound = true;
      })
      .addCase(createProduct.fulfilled, (state, action) => {
        if (action.payload) state.items.unshift(action.payload);
      })
      .addCase(bulkAssignOwner.fulfilled, applyMany)
      .addCase(bulkChangeCategory.fulfilled, applyMany)
      .addCase(bulkChangeStatus.fulfilled, applyMany)
      .addCase(bulkTagProducts.fulfilled, applyMany)
      .addCase(bulkArchiveProducts.fulfilled, applyMany);

    [updateProduct, archiveProduct, restoreProduct].forEach((thunk) => builder.addCase(thunk.fulfilled, applyOne));
  },
});

export default productsSlice.reducer;
