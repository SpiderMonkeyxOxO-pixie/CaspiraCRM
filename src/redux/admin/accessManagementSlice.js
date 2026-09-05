import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";

// One shared slice for Members / Invitations / Invite Links / Access Audit
// — deliberately not four independent slices, so every Access Management
// route reads from and writes to the same in-memory tree (see
// mockAccessData.js's header comment for the full frontend-only scope
// statement: no real Gmail, no real tokens, no real accounts/memberships).

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------
export const fetchOrganizations = createAsyncThunk("accessManagement/fetchOrganizations", async (_, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/admin/organizations");
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load organizations");
  }
});

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------
export const fetchMembers = createAsyncThunk("accessManagement/fetchMembers", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/admin/members", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load Members");
  }
});

export const changeMemberRole = createAsyncThunk("accessManagement/changeMemberRole", async ({ id, newRoleId, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to change a member's role.");
  try {
    const res = axiosInstance.post(`/admin/members/${id}/role`, { newRoleId, reason });
    toast.promise(res, { loading: "Changing role...", success: "Role changed", error: "Failed to change role" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to change role");
  }
});

export const suspendMember = createAsyncThunk("accessManagement/suspendMember", async ({ id, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to suspend a member.");
  try {
    const res = axiosInstance.post(`/admin/members/${id}/suspend`, { reason });
    toast.promise(res, { loading: "Suspending member...", success: "Member suspended", error: "Failed to suspend member" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to suspend member");
  }
});

export const reactivateMember = createAsyncThunk("accessManagement/reactivateMember", async ({ id, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to reactivate a member.");
  try {
    const res = axiosInstance.post(`/admin/members/${id}/reactivate`, { reason });
    toast.promise(res, { loading: "Reactivating member...", success: "Member reactivated", error: "Failed to reactivate member" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to reactivate member");
  }
});

export const removeMember = createAsyncThunk("accessManagement/removeMember", async ({ id, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to remove a member.");
  try {
    const res = axiosInstance.post(`/admin/members/${id}/remove`, { reason });
    toast.promise(res, { loading: "Removing member...", success: "Member removed", error: "Failed to remove member" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to remove member");
  }
});

export const assignMemberDepartmentTeam = createAsyncThunk("accessManagement/assignMemberDepartmentTeam", async ({ id, ...payload }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post(`/admin/members/${id}/assign`, payload);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to update department/team");
  }
});

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------
export const fetchInvitations = createAsyncThunk("accessManagement/fetchInvitations", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/admin/invitations", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load Invitations");
  }
});

export const validateInvitationRecipient = createAsyncThunk("accessManagement/validateInvitationRecipient", async ({ email, organizationId }, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/admin/invitations/validate-recipient", { params: { email, organizationId } });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to validate recipient");
  }
});

export const createInvitation = createAsyncThunk("accessManagement/createInvitation", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/admin/invitations", payload);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to create the invitation" });
  }
});

export const resendInvitation = createAsyncThunk("accessManagement/resendInvitation", async (id, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/admin/invitations/${id}/resend`);
    toast.promise(res, { loading: "Generating a new invitation preview...", success: "Invitation resent (preview)", error: "Failed to resend invitation" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to resend invitation");
  }
});

export const revokeInvitation = createAsyncThunk("accessManagement/revokeInvitation", async ({ id, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to revoke an invitation.");
  try {
    const res = axiosInstance.post(`/admin/invitations/${id}/revoke`, { reason });
    toast.promise(res, { loading: "Revoking invitation...", success: "Invitation revoked", error: "Failed to revoke invitation" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to revoke invitation");
  }
});

export const approveJoinRequest = createAsyncThunk("accessManagement/approveJoinRequest", async (id, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/admin/invitations/${id}/approve`);
    toast.promise(res, { loading: "Approving membership...", success: "Membership approved (preview)", error: "Failed to approve membership" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to approve membership");
  }
});

export const rejectJoinRequest = createAsyncThunk("accessManagement/rejectJoinRequest", async ({ id, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to reject a membership request.");
  try {
    const { data } = await axiosInstance.post(`/admin/invitations/${id}/reject`, { reason });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to reject membership request");
  }
});

// ---------------------------------------------------------------------------
// Invite Links
// ---------------------------------------------------------------------------
export const fetchInviteLinks = createAsyncThunk("accessManagement/fetchInviteLinks", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/admin/invite-links", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load Invite Links");
  }
});

export const createInviteLink = createAsyncThunk("accessManagement/createInviteLink", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.post("/admin/invite-links", payload);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to create the invite link" });
  }
});

export const rotateInviteLink = createAsyncThunk("accessManagement/rotateInviteLink", async (id, { rejectWithValue }) => {
  try {
    const res = axiosInstance.post(`/admin/invite-links/${id}/rotate`);
    toast.promise(res, { loading: "Rotating link...", success: "Invite link rotated", error: "Failed to rotate link" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to rotate link");
  }
});

export const revokeInviteLink = createAsyncThunk("accessManagement/revokeInviteLink", async ({ id, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to revoke an invite link.");
  try {
    const res = axiosInstance.post(`/admin/invite-links/${id}/revoke`, { reason });
    toast.promise(res, { loading: "Revoking link...", success: "Invite link revoked", error: "Failed to revoke link" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to revoke link");
  }
});

// ---------------------------------------------------------------------------
// Access Audit
// ---------------------------------------------------------------------------
export const fetchAccessAudit = createAsyncThunk("accessManagement/fetchAccessAudit", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await axiosInstance.get("/admin/access-audit", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load the Access Audit");
  }
});

const initialState = {
  organizations: [],
  members: [],
  memberCounts: null,
  teams: [],
  departments: [],
  invitations: [],
  invitationCounts: null,
  recipientValidation: null,
  inviteLinks: [],
  inviteLinkCounts: null,
  auditEvents: [],
  loading: false,
  error: null,
};

function applyMember(state, action) {
  const updated = action.payload?.member;
  if (!updated) return;
  const idx = state.members.findIndex((m) => m.id === updated.id);
  if (idx >= 0) state.members[idx] = updated;
  else state.members.unshift(updated);
}

function applyInvitation(state, action) {
  const updated = action.payload?.invitation;
  if (!updated) return;
  const idx = state.invitations.findIndex((i) => i.id === updated.id);
  if (idx >= 0) state.invitations[idx] = updated;
}

function applyInviteLink(state, action) {
  const updated = action.payload?.link;
  if (!updated) return;
  const idx = state.inviteLinks.findIndex((l) => l.id === updated.id);
  if (idx >= 0) state.inviteLinks[idx] = updated;
}

const accessManagementSlice = createSlice({
  name: "accessManagement",
  initialState,
  reducers: {
    clearRecipientValidation(state) {
      state.recipientValidation = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchOrganizations.fulfilled, (state, action) => {
        state.organizations = action.payload?.organizations || [];
      })
      .addCase(fetchMembers.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchMembers.fulfilled, (state, action) => {
        state.loading = false;
        state.members = action.payload?.members || [];
        state.memberCounts = action.payload?.counts || null;
        state.teams = action.payload?.teams || state.teams;
        state.departments = action.payload?.departments || state.departments;
      })
      .addCase(fetchMembers.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchInvitations.fulfilled, (state, action) => {
        state.invitations = action.payload?.invitations || [];
        state.invitationCounts = action.payload?.counts || null;
      })
      .addCase(validateInvitationRecipient.fulfilled, (state, action) => {
        state.recipientValidation = action.payload;
      })
      .addCase(createInvitation.fulfilled, (state, action) => {
        if (action.payload?.invitation) state.invitations.unshift(action.payload.invitation);
      })
      .addCase(approveJoinRequest.fulfilled, (state, action) => {
        applyInvitation(state, action);
        applyMember(state, action);
      })
      .addCase(rejectJoinRequest.fulfilled, (state, action) => applyInvitation(state, action))
      .addCase(fetchInviteLinks.fulfilled, (state, action) => {
        state.inviteLinks = action.payload?.inviteLinks || [];
        state.inviteLinkCounts = action.payload?.counts || null;
      })
      .addCase(createInviteLink.fulfilled, (state, action) => {
        if (action.payload?.link) state.inviteLinks.unshift(action.payload.link);
      })
      .addCase(fetchAccessAudit.fulfilled, (state, action) => {
        state.auditEvents = action.payload?.events || [];
      });

    [changeMemberRole, suspendMember, reactivateMember, removeMember, assignMemberDepartmentTeam].forEach((thunk) =>
      builder.addCase(thunk.fulfilled, applyMember)
    );
    [resendInvitation, revokeInvitation].forEach((thunk) => builder.addCase(thunk.fulfilled, applyInvitation));
    [rotateInviteLink, revokeInviteLink].forEach((thunk) => builder.addCase(thunk.fulfilled, applyInviteLink));
  },
});

export const { clearRecipientValidation } = accessManagementSlice.actions;
export default accessManagementSlice.reducer;

export function selectAccessManagement(state) {
  return state.accessManagement;
}
