// Typed adapter for Backend Phase 1's new session-based auth/organizations/
// RBAC surface (/api/v1/auth/*, /api/v1/organizations/*, /api/v1/invitations/*,
// /api/v1/join/*). Deliberately separate from axiosInstance.js/mockApi.js —
// this never touches localStorage for tokens (httpOnly cookies only) and
// isn't wired into the live Login page or Redux authSlice in this phase;
// see docs/BACKEND_PHASE1.md's "Switching the frontend" section for how and
// when to adopt it. Building this now, ahead of that switch, is what the
// Backend Phase 1 spec calls for ("Add or revise a typed frontend API
// adapter... Keep the existing mock adapter available... until backend
// parity is confirmed").
import axios from "axios";

const BASE_URL = import.meta.env.VITE_BACKEND_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api/v1";

// Explicit, separate from VITE_USE_MOCK_API (which only ever gated the
// legacy Bearer-JWT/mock CRM surface) — never silently mixed with it. See
// getApiMode() below for a single source of truth on which is active.
export const BACKEND_AUTH_MODE_ENABLED = import.meta.env.VITE_BACKEND_AUTH_MODE === "true";

export function getApiMode() {
  return {
    crmDataSource: import.meta.env.VITE_USE_MOCK_API !== "false" ? "mock" : "backend",
    authSource: BACKEND_AUTH_MODE_ENABLED ? "backend" : "not-wired",
  };
}

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

const client = axios.create({
  baseURL: BASE_URL,
  withCredentials: true, // required — the whole point is httpOnly session cookies, never a header token
  headers: { "Content-Type": "application/json" },
});

// Double-submit CSRF: the server sets a readable csrm_csrf cookie on every
// login/refresh; every mutation must echo it back in this header.
client.interceptors.request.use((config) => {
  if (!["get", "head", "options"].includes((config.method || "get").toLowerCase())) {
    const csrfToken = readCookie("csrm_csrf");
    if (csrfToken) config.headers["X-CSRF-Token"] = csrfToken;
  }
  return config;
});

// One-shot, non-recursive refresh-on-401 — a second 401 (e.g. from the
// refresh call itself) is never retried again, so a truly dead session
// fails cleanly instead of looping.
let refreshInFlight = null;
client.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original?._retried && !original?.url?.includes("/auth/refresh") && !original?.url?.includes("/auth/login")) {
      original._retried = true;
      try {
        refreshInFlight ||= client.post("/auth/refresh");
        await refreshInFlight;
        refreshInFlight = null;
        return client(original);
      } catch (refreshError) {
        refreshInFlight = null;
        throw refreshError;
      }
    }
    throw error;
  }
);

// --- Auth ---
export const login = (email, password) => client.post("/auth/login", { email, password }).then((r) => r.data);
// The Login page's single field accepts either — the server resolves it.
// otp: the authenticator code, required (Backend Phase 13) when the account has
// two-factor authentication enabled — the first attempt answers MFA_REQUIRED.
export const loginWithIdentifier = (identifier, password, otp) =>
  client.post("/auth/login", { ...(identifier.includes("@") ? { email: identifier } : { username: identifier }), password, ...(otp ? { otp } : {}) }).then((r) => r.data);
export const logout = () => client.post("/auth/logout").then((r) => r.data);
export const refreshSession = () => client.post("/auth/refresh").then((r) => r.data);
export const getCurrentUser = () => client.get("/auth/me").then((r) => r.data);
export const forgotPassword = (email) => client.post("/auth/forgot-password", { email }).then((r) => r.data);
export const resetPassword = (token, newPassword) => client.post("/auth/reset-password", { token, newPassword }).then((r) => r.data);
export const verifyEmail = (token) => client.post("/auth/verify-email", { token }).then((r) => r.data);
export const listSessions = () => client.get("/auth/sessions").then((r) => r.data);
export const revokeSession = (sessionId) => client.delete(`/auth/sessions/${sessionId}`).then((r) => r.data);
export const revokeOtherSessions = () => client.post("/auth/sessions/revoke-others").then((r) => r.data);

// --- The signed-in user's own account ---
export const updateMyProfile = (changes) => client.patch("/auth/me", changes).then((r) => r.data);
export const changeMyPassword = (currentPassword, newPassword) => client.post("/auth/password", { currentPassword, newPassword }).then((r) => r.data);
export const reauthenticate = (password) => client.post("/auth/reauthenticate", { password }).then((r) => r.data);
export const startMfaSetup = () => client.post("/auth/mfa/setup").then((r) => r.data);
export const enableMfa = (otp) => client.post("/auth/mfa/enable", { otp }).then((r) => r.data);
export const disableMfa = (otp) => client.post("/auth/mfa/disable", { otp }).then((r) => r.data);
export const getRecoveryCodeStatus = () => client.get("/auth/mfa/recovery-codes").then((r) => r.data);
export const regenerateRecoveryCodes = () => client.post("/auth/mfa/recovery-codes").then((r) => r.data);

// --- Organizations ---
export const listOrganizations = () => client.get("/organizations").then((r) => r.data);
export const createOrganization = (name, settings) => client.post("/organizations", { name, settings }).then((r) => r.data);
export const getOrganization = (organizationId) => client.get(`/organizations/${organizationId}`).then((r) => r.data);
export const updateOrganization = (organizationId, changes) => client.patch(`/organizations/${organizationId}`, changes).then((r) => r.data);

// --- Members and roles ---
export const listMembers = (organizationId, params) => client.get(`/organizations/${organizationId}/members`, { params }).then((r) => r.data);
export const getMember = (organizationId, memberId) => client.get(`/organizations/${organizationId}/members/${memberId}`).then((r) => r.data);
export const updateMember = (organizationId, memberId, status) => client.patch(`/organizations/${organizationId}/members/${memberId}`, { status }).then((r) => r.data);
export const removeMember = (organizationId, memberId) => client.delete(`/organizations/${organizationId}/members/${memberId}`).then((r) => r.data);
export const assignMemberRole = (organizationId, memberId, roleId) => client.post(`/organizations/${organizationId}/members/${memberId}/roles`, { roleId }).then((r) => r.data);
export const revokeMemberRole = (organizationId, memberId, roleId) => client.delete(`/organizations/${organizationId}/members/${memberId}/roles/${roleId}`).then((r) => r.data);
export const listOrgRoles = (organizationId) => client.get(`/organizations/${organizationId}/roles`).then((r) => r.data);
export const listOrgPermissions = (organizationId) => client.get(`/organizations/${organizationId}/permissions`).then((r) => r.data);
export const listAuditEvents = (organizationId, params) => client.get(`/organizations/${organizationId}/audit-events`, { params }).then((r) => r.data);

// --- Invitations ---
export const listInvitations = (organizationId) => client.get(`/organizations/${organizationId}/invitations`).then((r) => r.data);
export const createInvitation = (organizationId, payload) => client.post(`/organizations/${organizationId}/invitations`, payload).then((r) => r.data);
export const resendInvitation = (organizationId, invitationId) => client.post(`/organizations/${organizationId}/invitations/${invitationId}/resend`).then((r) => r.data);
export const revokeInvitation = (organizationId, invitationId) => client.post(`/organizations/${organizationId}/invitations/${invitationId}/revoke`).then((r) => r.data);
export const validateInvitationToken = (token) => client.get(`/invitations/${token}/validate`).then((r) => r.data);
export const acceptInvitation = (token, payload) => client.post(`/invitations/${token}/accept`, payload).then((r) => r.data);

// --- Invite links ---
export const listInviteLinks = (organizationId) => client.get(`/organizations/${organizationId}/invite-links`).then((r) => r.data);
export const createInviteLink = (organizationId, payload) => client.post(`/organizations/${organizationId}/invite-links`, payload).then((r) => r.data);
export const rotateInviteLink = (organizationId, linkId) => client.post(`/organizations/${organizationId}/invite-links/${linkId}/rotate`).then((r) => r.data);
export const revokeInviteLink = (organizationId, linkId) => client.post(`/organizations/${organizationId}/invite-links/${linkId}/revoke`).then((r) => r.data);
export const validateJoinToken = (token) => client.get(`/join/${token}/validate`).then((r) => r.data);
export const acceptJoinToken = (token, payload) => client.post(`/join/${token}/accept`, payload).then((r) => r.data);

export default client;
