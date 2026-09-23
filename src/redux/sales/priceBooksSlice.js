import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";
import * as backendCatalog from "../../Helpers/crmCatalogBackend";

// Re-exported from mockPriceBookData for callers that import enums from this
// slice — mockPriceBookData.js is the single source of truth for these lists.
export {
  PRICE_BOOK_STATUSES, SETTABLE_STATUSES, PRICE_BOOK_CURRENCIES, MARKETS, CUSTOMER_SEGMENTS,
  SALES_CHANNELS, CONTRACT_TYPES, PRICE_BOOK_DEAL_TYPES, ADJUSTMENT_TYPES, MIN_PRIORITY, MAX_PRIORITY,
  EXPIRING_SOON_DAYS, PRIORITY_RESOLUTION_ORDER, SPECIFICITY_LABELS,
} from "../../Helpers/mockPriceBookData";

// VITE_BACKEND_CRM_SALES_MODE=true reads/writes Price Books through the real
// /sales/price-books API (crmCatalogBackend.js); otherwise the mock layer.
const BACKEND = backendCatalog.BACKEND_ENABLED;
const errorMessage = (error, fallback) => error.response?.data?.message || (BACKEND ? error.message : null) || fallback;
const errorBody = (error, fallback) => error.response?.data || { message: (BACKEND && error.message) || fallback };

// Deliberately NOT server-shaped/paginated — same pattern as Products: the
// whole set is fetched once and PriceBooksList filters/sorts/paginates
// client-side via queryPriceBooksLocal().
export const fetchPriceBooks = createAsyncThunk("sales/priceBooks/fetchAll", async (_, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendCatalog.listPriceBooks();
    const { data } = await axiosInstance.get("/sales/price-books");
    return data.priceBooks;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to load Price Books"));
  }
});

export const fetchPriceBook = createAsyncThunk("sales/priceBooks/fetchOne", async (id, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendCatalog.getPriceBook(id);
    const { data } = await axiosInstance.get(`/sales/price-books/${id}`);
    return data.priceBook;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to load the Price Book"));
  }
});

export const createPriceBook = createAsyncThunk("sales/priceBooks/create", async (payload, { rejectWithValue }) => {
  try {
    const res = BACKEND
      ? backendCatalog.createPriceBook(payload).then((priceBook) => ({ data: { priceBook } }))
      : axiosInstance.post("/sales/price-books", payload);
    toast.promise(res, { loading: "Adding Price Book...", success: "Price Book added", error: (err) => errorMessage(err, "Failed to add Price Book") });
    const { data } = await res;
    return data.priceBook;
  } catch (error) {
    return rejectWithValue(errorBody(error, "Failed to add Price Book"));
  }
});

export const updatePriceBook = createAsyncThunk("sales/priceBooks/update", async ({ id, changes }, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendCatalog.updatePriceBook(id, changes);
    const { data } = await axiosInstance.put(`/sales/price-books/${id}`, changes);
    return data.priceBook;
  } catch (error) {
    return rejectWithValue(errorBody(error, "Failed to update the Price Book"));
  }
});

export const archivePriceBook = createAsyncThunk("sales/priceBooks/archive", async ({ id, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to archive a Price Book");
  try {
    const res = BACKEND
      ? backendCatalog.archivePriceBook(id, reason).then((priceBook) => ({ data: { priceBook } }))
      : axiosInstance.post(`/sales/price-books/${id}/archive`, { reason });
    toast.promise(res, { loading: "Archiving...", success: "Price Book archived", error: "Failed to archive Price Book" });
    const { data } = await res;
    return data.priceBook;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to archive Price Book"));
  }
});

export const restorePriceBook = createAsyncThunk("sales/priceBooks/restore", async (id, { rejectWithValue }) => {
  try {
    const res = BACKEND
      ? backendCatalog.restorePriceBook(id).then((priceBook) => ({ data: { priceBook } }))
      : axiosInstance.post(`/sales/price-books/${id}/restore`);
    toast.promise(res, { loading: "Restoring...", success: "Price Book restored", error: "Failed to restore Price Book" });
    const { data } = await res;
    return data.priceBook;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to restore Price Book"));
  }
});

export const bulkAssignOwner = createAsyncThunk("sales/priceBooks/bulkAssign", async ({ priceBookIds, ownerId }, { rejectWithValue }) => {
  try {
    const list = BACKEND
      ? await backendCatalog.bulkAssignPriceBooks(priceBookIds, ownerId)
      : (await axiosInstance.post("/sales/price-books/bulk/assign", { priceBookIds, ownerId })).data.priceBooks;
    toast.success(`${list.length} Price Book(s) reassigned`);
    return list;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to bulk assign"));
  }
});

export const bulkChangeStatus = createAsyncThunk("sales/priceBooks/bulkStatus", async ({ priceBookIds, status }, { rejectWithValue }) => {
  try {
    const list = BACKEND
      ? await backendCatalog.bulkStatusPriceBooks(priceBookIds, status)
      : (await axiosInstance.post("/sales/price-books/bulk/status", { priceBookIds, status })).data.priceBooks;
    toast.success(`${list.length} Price Book(s) updated`);
    return list;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to bulk change status"));
  }
});

export const bulkArchivePriceBooks = createAsyncThunk("sales/priceBooks/bulkArchive", async ({ priceBookIds, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to archive");
  try {
    const list = BACKEND
      ? await backendCatalog.bulkArchivePriceBooksById(priceBookIds, reason)
      : (await axiosInstance.post("/sales/price-books/bulk/archive", { priceBookIds, reason })).data.priceBooks;
    toast.success(`${list.length} Price Book(s) archived`);
    return list;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to bulk archive"));
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

const priceBooksSlice = createSlice({
  name: "priceBooks",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchPriceBooks.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchPriceBooks.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload || [];
      })
      .addCase(fetchPriceBooks.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchPriceBook.pending, (state) => {
        state.current = null;
        state.currentNotFound = false;
      })
      .addCase(fetchPriceBook.fulfilled, (state, action) => {
        state.current = action.payload;
        state.currentNotFound = false;
      })
      .addCase(fetchPriceBook.rejected, (state) => {
        // In-memory data resets on a full page reload — a bookmarked/shared
        // Price Book URL can 404 in a fresh session.
        state.current = null;
        state.currentNotFound = true;
      })
      .addCase(createPriceBook.fulfilled, (state, action) => {
        if (action.payload) state.items.unshift(action.payload);
      })
      .addCase(bulkAssignOwner.fulfilled, applyMany)
      .addCase(bulkChangeStatus.fulfilled, applyMany)
      .addCase(bulkArchivePriceBooks.fulfilled, applyMany);

    [updatePriceBook, archivePriceBook, restorePriceBook].forEach((thunk) => builder.addCase(thunk.fulfilled, applyOne));
  },
});

export default priceBooksSlice.reducer;
