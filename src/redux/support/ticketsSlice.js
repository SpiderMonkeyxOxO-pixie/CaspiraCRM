import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";
import * as backendTickets from "../../Helpers/supportTicketsBackend";

// VITE_BACKEND_SUPPORT_MODE=true reads/writes tickets through the real
// /support/tickets API (supportTicketsBackend.js); otherwise the mock layer.
const BACKEND = backendTickets.BACKEND_ENABLED;
const errorMessage = (error, fallback) => error.response?.data?.message || (BACKEND ? error.message : null) || fallback;

export const TICKET_STATUSES = ["New", "Open", "In Progress", "Waiting for Customer", "Waiting for Internal Team", "Resolved", "Closed", "Cancelled"];
export const TICKET_PRIORITIES = ["Low", "Medium", "High", "Urgent"];
export const TICKET_CATEGORIES = ["Billing", "Technical", "Account", "General"];
export const TICKET_SOURCES = ["Email", "Phone", "Chat", "Portal"];

export const fetchTickets = createAsyncThunk("support/tickets/fetchAll", async (_, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendTickets.listTickets();
    const { data } = await axiosInstance.get("/support/tickets");
    return data.tickets;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to load tickets"));
  }
});

export const fetchTicket = createAsyncThunk("support/tickets/fetchOne", async (id, { rejectWithValue }) => {
  try {
    if (BACKEND) return await backendTickets.getTicket(id);
    const { data } = await axiosInstance.get(`/support/tickets/${id}`);
    return data.ticket;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to load ticket"));
  }
});

export const createTicket = createAsyncThunk("support/tickets/create", async (ticketData, { rejectWithValue }) => {
  try {
    const res = BACKEND ? backendTickets.createTicket(ticketData).then((ticket) => ({ data: { ticket } })) : axiosInstance.post("/support/tickets", ticketData);
    toast.promise(res, { loading: "Creating ticket...", success: "Ticket created", error: "Failed to create ticket" });
    const { data } = await res;
    return data.ticket;
  } catch (error) {
    return rejectWithValue(errorMessage(error, "Failed to create ticket"));
  }
});

export const updateTicketStatus = createAsyncThunk(
  "support/tickets/updateStatus",
  async ({ id, status }, { rejectWithValue }) => {
    try {
      if (BACKEND) return await backendTickets.advanceTicket(id, status);
      const { data } = await axiosInstance.put(`/support/tickets/${id}`, { status });
      return data.ticket;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to update ticket"));
    }
  }
);

export const assignTicket = createAsyncThunk(
  "support/tickets/assign",
  async ({ id, assignedAgent, assignedAgentId, department }, { rejectWithValue }) => {
    try {
      if (BACKEND) {
        const ticket = await backendTickets.assignTicket(id, { assignedAgentId, department });
        toast.success("Ticket assigned");
        return ticket;
      }
      const { data } = await axiosInstance.put(`/support/tickets/${id}`, { assignedAgent, department });
      toast.success("Ticket assigned");
      return data.ticket;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to assign ticket"));
    }
  }
);

export const addPublicReply = createAsyncThunk(
  "support/tickets/addPublicReply",
  async ({ id, message, author }, { rejectWithValue }) => {
    if (!message?.trim()) return rejectWithValue("Reply cannot be empty");
    try {
      if (BACKEND) return await backendTickets.replyToTicket(id, message);
      const { data } = await axiosInstance.post(`/support/tickets/${id}/replies`, { message, author });
      return data.ticket;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to add reply"));
    }
  }
);

export const addPrivateNote = createAsyncThunk(
  "support/tickets/addPrivateNote",
  async ({ id, message, author }, { rejectWithValue }) => {
    if (!message?.trim()) return rejectWithValue("Note cannot be empty");
    try {
      if (BACKEND) return await backendTickets.addTicketNote(id, message);
      const { data } = await axiosInstance.post(`/support/tickets/${id}/notes`, { message, author });
      return data.ticket;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to add note"));
    }
  }
);

export const escalateTicket = createAsyncThunk(
  "support/tickets/escalate",
  async ({ id, to, reason }, { rejectWithValue }) => {
    if (!reason?.trim()) return rejectWithValue("A reason is required to escalate a ticket");
    try {
      const res = BACKEND
        ? backendTickets.escalateTicket(id, to, reason).then((ticket) => ({ data: { ticket } }))
        : axiosInstance.post(`/support/tickets/${id}/escalate`, { to, reason });
      toast.promise(res, { loading: "Escalating...", success: "Ticket escalated", error: "Failed to escalate ticket" });
      const { data } = await res;
      return data.ticket;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to escalate ticket"));
    }
  }
);

export const resolveTicket = createAsyncThunk(
  "support/tickets/resolve",
  async ({ id, summary }, { rejectWithValue }) => {
    if (!summary?.trim()) return rejectWithValue("A resolution summary is required");
    try {
      const res = BACKEND
        ? backendTickets.resolveTicket(id, summary).then((ticket) => ({ data: { ticket } }))
        : axiosInstance.post(`/support/tickets/${id}/resolve`, { summary });
      toast.promise(res, { loading: "Resolving...", success: "Ticket resolved", error: "Failed to resolve ticket" });
      const { data } = await res;
      return data.ticket;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to resolve ticket"));
    }
  }
);

export const submitCsat = createAsyncThunk(
  "support/tickets/submitCsat",
  async ({ id, score }, { rejectWithValue }) => {
    try {
      if (BACKEND) return await backendTickets.closeTicket(id);
      const { data } = await axiosInstance.put(`/support/tickets/${id}`, { csatScore: score, status: "Closed" });
      return data.ticket;
    } catch (error) {
      return rejectWithValue(errorMessage(error, "Failed to submit feedback"));
    }
  }
);

const applyUpdate = (state, action) => {
  const updated = action.payload;
  if (!updated) return;
  state.items = state.items.map((t) => (t._id === updated._id ? updated : t));
  if (state.current?._id === updated._id) state.current = updated;
};

const ticketsSlice = createSlice({
  name: "tickets",
  initialState: { items: [], current: null, loading: false, error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchTickets.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchTickets.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload || [];
      })
      .addCase(fetchTickets.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchTicket.fulfilled, (state, action) => {
        state.current = action.payload;
      })
      .addCase(createTicket.fulfilled, (state, action) => {
        if (action.payload) state.items.unshift(action.payload);
      })
      .addCase(escalateTicket.rejected, (state, action) => {
        toast.error(action.payload || "Failed to escalate ticket");
      })
      .addCase(resolveTicket.rejected, (state, action) => {
        toast.error(action.payload || "Failed to resolve ticket");
      })
      .addCase(addPublicReply.rejected, (state, action) => {
        toast.error(action.payload || "Failed to add reply");
      })
      .addCase(addPrivateNote.rejected, (state, action) => {
        toast.error(action.payload || "Failed to add note");
      });

    [updateTicketStatus, assignTicket, addPublicReply, addPrivateNote, escalateTicket, resolveTicket, submitCsat].forEach(
      (thunk) => builder.addCase(thunk.fulfilled, applyUpdate)
    );
  },
});

export default ticketsSlice.reducer;
