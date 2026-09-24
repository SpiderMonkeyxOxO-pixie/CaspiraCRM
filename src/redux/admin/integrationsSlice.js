import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import axiosInstance from "../../Helpers/axiosInstance";
import * as ib from "../../Helpers/integrationsBackend";

// Backend mode (VITE_BACKEND_INTEGRATIONS_MODE=true): the core Integration
// Center thunks (providers, connections, connect, test, pause/resume,
// disconnect, synchronization, activity, webhooks) call the real API through
// integrationsBackend.js. Every other Integration Center call is refused with
// a clear message instead of silently reading demo data.
const backendMessage = (e) => e?.response?.data?.message || e?.message || "The request failed.";
async function viaBackend(fn, rejectWithValue, messages) {
  const p = fn();
  if (messages) toast.promise(p, { loading: messages.loading, success: messages.success, error: (e) => backendMessage(e) });
  try {
    return await p;
  } catch (e) {
    return rejectWithValue(backendMessage(e));
  }
}
const refuse = () => Promise.reject({ response: { data: { message: ib.unavailable("This Integration Center screen").message } } });
const mockApi = ib.BACKEND_ENABLED ? { get: refuse, post: refuse } : axiosInstance;

// One shared slice for the Integration Center — Marketplace/Providers,
// Connections, Synchronization, Activity and Webhook previews all read from
// and write to the same in-memory tree (see mockIntegrationsData.js's header
// comment for the full frontend-only scope statement: no real provider is
// ever contacted, no real credential is ever stored).

// ---------------------------------------------------------------------------
// Organizations — reuses the SAME endpoint/fixture Access Management already
// registered; this thunk is intentionally its own small copy so this slice
// stays decoupled from accessManagementSlice.js, without duplicating any
// fixture data (there is exactly one ORGANIZATIONS array, in mockAccessData.js).
// ---------------------------------------------------------------------------
export const fetchOrganizations = createAsyncThunk("integrations/fetchOrganizations", async (_, { rejectWithValue }) => {
  if (ib.BACKEND_ENABLED) return viaBackend(() => ib.listOrganizations(), rejectWithValue);
  try {
    const { data } = await mockApi.get("/admin/organizations");
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load organizations");
  }
});

// ---------------------------------------------------------------------------
// Providers (global catalog — not org-scoped)
// ---------------------------------------------------------------------------
export const fetchProviders = createAsyncThunk("integrations/fetchProviders", async (filters, { rejectWithValue }) => {
  if (ib.BACKEND_ENABLED) return viaBackend(() => ib.listProviders(filters || {}), rejectWithValue);
  try {
    const { data } = await mockApi.get("/admin/integrations/providers", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load the integration marketplace");
  }
});

export const fetchProvider = createAsyncThunk("integrations/fetchProvider", async (providerKey, { rejectWithValue }) => {
  if (ib.BACKEND_ENABLED) return viaBackend(() => ib.getProvider(providerKey), rejectWithValue);
  try {
    const { data } = await mockApi.get(`/admin/integrations/providers/${providerKey}`);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load the provider");
  }
});

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------
export const fetchConnections = createAsyncThunk("integrations/fetchConnections", async (filters, { rejectWithValue }) => {
  if (ib.BACKEND_ENABLED) return viaBackend(() => ib.listConnections(filters || {}), rejectWithValue);
  try {
    const { data } = await mockApi.get("/admin/integrations/connections", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load connections");
  }
});

export const fetchConnection = createAsyncThunk("integrations/fetchConnection", async (connectionId, { rejectWithValue }) => {
  if (ib.BACKEND_ENABLED) return viaBackend(() => ib.getConnection(connectionId), rejectWithValue);
  try {
    const { data } = await mockApi.get(`/admin/integrations/connections/${connectionId}`);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load the connection");
  }
});

export const createConnectionPreview = createAsyncThunk("integrations/createConnectionPreview", async (payload, { rejectWithValue }) => {
  if (ib.BACKEND_ENABLED) return viaBackend(() => ib.connect(payload), rejectWithValue, { loading: "Starting the provider sign-in...", success: "Redirecting to the provider..." });
  try {
    const res = mockApi.post("/admin/integrations/connections", payload);
    toast.promise(res, { loading: "Creating preview connection...", success: "Preview connection created", error: "Failed to create the preview connection" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: "Failed to create the preview connection" });
  }
});

export const pauseConnection = createAsyncThunk("integrations/pauseConnection", async (connectionId, { rejectWithValue }) => {
  if (ib.BACKEND_ENABLED) return viaBackend(() => ib.pause(connectionId), rejectWithValue, { loading: "Pausing synchronization...", success: "Synchronization paused" });
  try {
    const res = mockApi.post(`/admin/integrations/connections/${connectionId}/pause`);
    toast.promise(res, { loading: "Pausing preview...", success: "Preview paused", error: "Failed to pause the preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to pause the preview");
  }
});

export const resumeConnection = createAsyncThunk("integrations/resumeConnection", async (connectionId, { rejectWithValue }) => {
  if (ib.BACKEND_ENABLED) return viaBackend(() => ib.resume(connectionId), rejectWithValue, { loading: "Resuming...", success: "Resumed" });
  try {
    const res = mockApi.post(`/admin/integrations/connections/${connectionId}/resume`);
    toast.promise(res, { loading: "Resuming preview...", success: "Preview resumed", error: "Failed to resume the preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to resume the preview");
  }
});

export const disconnectConnection = createAsyncThunk("integrations/disconnectConnection", async ({ id, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to disconnect a preview connection.");
  if (ib.BACKEND_ENABLED) return viaBackend(() => ib.disconnect(id, reason), rejectWithValue, { loading: "Disconnecting and revoking access...", success: "Disconnected" });
  try {
    const res = mockApi.post(`/admin/integrations/connections/${id}/disconnect`, { reason });
    toast.promise(res, { loading: "Disconnecting preview...", success: "Preview disconnected", error: "Failed to disconnect the preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to disconnect the preview");
  }
});

export const undoDisconnectConnection = createAsyncThunk("integrations/undoDisconnectConnection", async (connectionId, { rejectWithValue }) => {
  if (ib.BACKEND_ENABLED) return rejectWithValue("A disconnected connection can't be restored — its credentials were revoked. Connect again instead.");
  try {
    const res = mockApi.post(`/admin/integrations/connections/${connectionId}/undo-disconnect`);
    toast.promise(res, { loading: "Undoing disconnect...", success: "Disconnect undone", error: "Failed to undo — the undo window for this session may have passed" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to undo the disconnect");
  }
});

export const runPreviewSync = createAsyncThunk("integrations/runPreviewSync", async ({ connectionId, jobType }, { rejectWithValue }) => {
  if (ib.BACKEND_ENABLED) return viaBackend(() => ib.runSync(connectionId), rejectWithValue, { loading: "Preparing synchronization...", success: "Synchronization preview ready — nothing was written until you confirm" });
  try {
    const res = mockApi.post(`/admin/integrations/connections/${connectionId}/sync`, { jobType });
    toast.promise(res, { loading: "Running preview synchronization...", success: "Preview synchronization complete", error: "Preview synchronization failed" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to run the preview synchronization");
  }
});

export const retryFailedSync = createAsyncThunk("integrations/retryFailedSync", async ({ connectionId, jobId }, { rejectWithValue }) => {
  if (ib.BACKEND_ENABLED) return viaBackend(() => ib.runSync(connectionId), rejectWithValue, { loading: "Retrying...", success: "Synchronization queued" });
  try {
    const res = mockApi.post(`/admin/integrations/connections/${connectionId}/sync/${jobId}/retry`);
    toast.promise(res, { loading: "Retrying...", success: "Retry complete", error: "Retry failed" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to retry the synchronization");
  }
});

export const updateFieldMapping = createAsyncThunk("integrations/updateFieldMapping", async ({ connectionId, mappingId, changes }, { rejectWithValue }) => {
  if (ib.BACKEND_ENABLED) return rejectWithValue(ib.unavailable("Field-level mapping").message);
  try {
    const res = mockApi.post(`/admin/integrations/connections/${connectionId}/mappings/${mappingId}`, changes);
    toast.promise(res, { loading: "Saving field mapping...", success: "Field mapping saved", error: "Failed to save the field mapping" });
    const { data } = await res;
    return { connectionId, ...data };
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to save the field mapping");
  }
});

export const updateConnectionConfig = createAsyncThunk("integrations/updateConnectionConfig", async ({ connectionId, changes }, { rejectWithValue }) => {
  if (ib.BACKEND_ENABLED) return rejectWithValue("Capabilities are changed by reauthorizing the connection with the scopes they need.");
  try {
    const res = mockApi.post(`/admin/integrations/connections/${connectionId}/config`, changes);
    toast.promise(res, { loading: "Saving preview configuration...", success: "Preview configuration saved", error: "Failed to save the preview configuration" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to save the preview configuration");
  }
});

export const testPreviewConnection = createAsyncThunk("integrations/testPreviewConnection", async (connectionId, { rejectWithValue }) => {
  if (ib.BACKEND_ENABLED) return viaBackend(() => ib.testConnection(connectionId), rejectWithValue, { loading: "Testing the connection...", success: "Connection verified" });
  try {
    const res = mockApi.post(`/admin/integrations/connections/${connectionId}/test`);
    toast.promise(res, { loading: "Testing preview connection...", success: "Preview connection test complete", error: "Preview connection test failed" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to test the preview connection");
  }
});

// Backend mode only: confirm a synchronization preview, set up
// synchronization for a capability, cancel a queued run.
export const confirmSyncPreview = createAsyncThunk("integrations/confirmSyncPreview", async ({ connectionId, previewRunId }, { rejectWithValue }) => {
  if (!ib.BACKEND_ENABLED) return rejectWithValue("Confirming a synchronization needs the real backend.");
  return viaBackend(() => ib.confirmPreview(connectionId, previewRunId), rejectWithValue, { loading: "Starting synchronization...", success: "Synchronization started" });
});

export const saveSyncConfiguration = createAsyncThunk("integrations/saveSyncConfiguration", async ({ connectionId, body }, { rejectWithValue }) => {
  if (!ib.BACKEND_ENABLED) return rejectWithValue("Synchronization setup needs the real backend.");
  return viaBackend(() => ib.saveSyncConfiguration(connectionId, body), rejectWithValue, { loading: "Saving synchronization setup...", success: "Synchronization setup saved" });
});

export const cancelSyncRun = createAsyncThunk("integrations/cancelSyncRun", async ({ connectionId, runId }, { rejectWithValue }) => {
  if (!ib.BACKEND_ENABLED) return rejectWithValue("Cancelling needs the real backend.");
  return viaBackend(() => ib.cancelRun(connectionId, runId), rejectWithValue, { loading: "Cancelling...", success: "Cancelled" });
});

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------
export const fetchActivity = createAsyncThunk("integrations/fetchActivity", async (filters, { rejectWithValue }) => {
  if (ib.BACKEND_ENABLED) return viaBackend(() => ib.listActivity(filters || {}), rejectWithValue);
  try {
    const { data } = await mockApi.get("/admin/integrations/activity", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load integration activity");
  }
});

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------
export const fetchWebhooks = createAsyncThunk("integrations/fetchWebhooks", async (filters, { rejectWithValue }) => {
  if (ib.BACKEND_ENABLED) return viaBackend(() => ib.listWebhooks(), rejectWithValue);
  try {
    const { data } = await mockApi.get("/admin/integrations/webhooks", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load webhook previews");
  }
});

// ---------------------------------------------------------------------------
// Sales & Marketing Integrations (Phase 2) — same shared slice, extended
// rather than forked. See mockSalesMarketingData.js for the frontend-only
// scope statement.
// ---------------------------------------------------------------------------
export const fetchLeadCaptureEvents = createAsyncThunk("integrations/fetchLeadCaptureEvents", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/sales-marketing/lead-capture", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load Lead Capture events");
  }
});

export const createLeadFromCapture = createAsyncThunk("integrations/createLeadFromCapture", async ({ eventId, overrides }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/sales-marketing/lead-capture/${eventId}/create-lead`, overrides || {});
    toast.promise(res, { loading: "Creating Lead preview...", success: "Lead created in preview", error: "Failed to create the Lead preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to create the Lead preview");
  }
});

export const rejectLeadCapture = createAsyncThunk("integrations/rejectLeadCapture", async ({ eventId, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A reason is required to reject a captured lead.");
  try {
    const res = mockApi.post(`/admin/integrations/sales-marketing/lead-capture/${eventId}/reject`, { reason });
    toast.promise(res, { loading: "Rejecting captured lead...", success: "Captured lead rejected", error: "Failed to reject the captured lead" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to reject the captured lead");
  }
});

export const retryLeadCaptureProcessing = createAsyncThunk("integrations/retryLeadCaptureProcessing", async (eventId, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/sales-marketing/lead-capture/${eventId}/retry`);
    toast.promise(res, { loading: "Retrying...", success: "Capture event retried", error: "Failed to retry the capture event" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to retry the capture event");
  }
});

export const fetchAudiences = createAsyncThunk("integrations/fetchAudiences", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/sales-marketing/audiences", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load audiences");
  }
});

export const fetchSuppressionEntries = createAsyncThunk("integrations/fetchSuppressionEntries", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/sales-marketing/suppression", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load suppression entries");
  }
});

export const removeSuppressionEntry = createAsyncThunk("integrations/removeSuppressionEntry", async ({ entryId, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A written reason is required to remove a marketing suppression entry.");
  try {
    const res = mockApi.post(`/admin/integrations/sales-marketing/suppression/${entryId}/remove`, { reason });
    toast.promise(res, { loading: "Removing suppression entry...", success: "Suppression entry removed", error: "Failed to remove the suppression entry" });
    const { data } = await res;
    return { entryId, ...data };
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to remove the suppression entry");
  }
});

export const fetchEmailDeliveryEvents = createAsyncThunk("integrations/fetchEmailDeliveryEvents", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/sales-marketing/email-delivery", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load email delivery events");
  }
});

export const retryEmailDelivery = createAsyncThunk("integrations/retryEmailDelivery", async (eventId, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/sales-marketing/email-delivery/${eventId}/retry`);
    toast.promise(res, { loading: "Retrying delivery...", success: "Delivery preview retried", error: "Failed to retry the delivery preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to retry the delivery preview");
  }
});

export const fetchAttribution = createAsyncThunk("integrations/fetchAttribution", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/sales-marketing/attribution", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load attribution data");
  }
});

export const fetchFormConnections = createAsyncThunk("integrations/fetchFormConnections", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/sales-marketing/forms", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load form connections");
  }
});

export const updateSalesMarketingFormFieldMapping = createAsyncThunk("integrations/updateSalesMarketingFormFieldMapping", async ({ formConnectionId, mappingId, changes }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/sales-marketing/forms/${formConnectionId}/mappings/${mappingId}`, changes);
    toast.promise(res, { loading: "Saving field mapping...", success: "Field mapping saved", error: "Failed to save the field mapping" });
    const { data } = await res;
    return { formConnectionId, ...data };
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to save the field mapping");
  }
});

export const enableFormConnection = createAsyncThunk("integrations/enableFormConnection", async (formConnectionId, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/sales-marketing/forms/${formConnectionId}/enable`);
    toast.promise(res, { loading: "Enabling form...", success: "Form enabled", error: "Failed to enable the form" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to enable the form");
  }
});

export const fetchSalesMarketingOverviewMetrics = createAsyncThunk("integrations/fetchSalesMarketingOverviewMetrics", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/sales-marketing/overview-metrics", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load overview metrics");
  }
});

export const fetchAudienceEligibility = createAsyncThunk("integrations/fetchAudienceEligibility", async (audienceId, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get(`/admin/integrations/sales-marketing/audiences/${audienceId}/eligibility`);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load audience eligibility");
  }
});

export const fetchMarketingConsentSummary = createAsyncThunk("integrations/fetchMarketingConsentSummary", async (_, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/sales-marketing/consent-summary");
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load the marketing consent summary");
  }
});

export const checkLeadCaptureDuplicates = createAsyncThunk("integrations/checkLeadCaptureDuplicates", async (eventId, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.post(`/admin/integrations/sales-marketing/lead-capture/${eventId}/check-duplicates`);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to check for duplicates");
  }
});

// ---------------------------------------------------------------------------
// Customer Support and Communication Integrations (Phase 3) — same shared
// slice, extended again rather than forked. See mockSupportCommunicationData.js
// for the frontend-only scope statement.
// ---------------------------------------------------------------------------
export const fetchSupportOverviewMetrics = createAsyncThunk("integrations/fetchSupportOverviewMetrics", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/support-communication/overview-metrics", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load Support & Communication overview metrics");
  }
});

export const fetchSupportChannels = createAsyncThunk("integrations/fetchSupportChannels", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/support-communication/channels", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load support channels");
  }
});

export const fetchSupportConversations = createAsyncThunk("integrations/fetchSupportConversations", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/support-communication/inbox", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load conversations");
  }
});

export const fetchSupportConversation = createAsyncThunk("integrations/fetchSupportConversation", async (conversationId, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get(`/admin/integrations/support-communication/inbox/${conversationId}`);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load the conversation");
  }
});

export const sendMessagePreview = createAsyncThunk("integrations/sendMessagePreview", async ({ conversationId, visibility, body }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/support-communication/inbox/${conversationId}/messages`, { visibility, body });
    toast.promise(res, {
      loading: visibility === "Internal" ? "Saving internal note preview..." : "Sending reply preview...",
      success: visibility === "Internal" ? "Internal note preview added" : "Reply preview added — no provider message was sent",
      error: "Failed to add the message preview",
    });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to add the message preview");
  }
});

export const undoConversationMessage = createAsyncThunk("integrations/undoConversationMessage", async (conversationId, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/support-communication/inbox/${conversationId}/undo`);
    toast.promise(res, { loading: "Undoing...", success: "Message preview undone", error: "Failed to undo — the undo window for this session may have passed" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to undo the message preview");
  }
});

export const escalateConversationToTicket = createAsyncThunk("integrations/escalateConversationToTicket", async ({ conversationId, overrides }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/support-communication/inbox/${conversationId}/escalate`, overrides || {});
    toast.promise(res, { loading: "Escalating to Ticket...", success: "Ticket created in preview", error: "Failed to escalate to a Ticket" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to escalate to a Ticket");
  }
});

export const fetchSupportIdentityMatch = createAsyncThunk("integrations/fetchSupportIdentityMatch", async (conversationId, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get(`/admin/integrations/support-communication/inbox/${conversationId}/identity-match`);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load the identity match");
  }
});

export const fetchSupportTicketPreviews = createAsyncThunk("integrations/fetchSupportTicketPreviews", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/support-communication/tickets", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load ticket previews");
  }
});

export const fetchSupportSyncConflicts = createAsyncThunk("integrations/fetchSupportSyncConflicts", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/support-communication/tickets/conflicts", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load synchronization conflicts");
  }
});

export const resolveSupportSyncConflict = createAsyncThunk("integrations/resolveSupportSyncConflict", async ({ conflictId, resolution, note }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/support-communication/tickets/conflicts/${conflictId}/resolve`, { resolution, note });
    toast.promise(res, { loading: "Resolving conflict...", success: "Conflict resolved", error: "Failed to resolve the conflict" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to resolve the conflict");
  }
});

export const assignTicketPreview = createAsyncThunk("integrations/assignTicketPreview", async ({ ticketId, agentId }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/support-communication/tickets/${ticketId}/assign`, { agentId });
    toast.promise(res, { loading: "Assigning preview...", success: "Ticket assigned in preview", error: "Failed to assign the ticket" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to assign the ticket");
  }
});

export const changeTicketStatusPreview = createAsyncThunk("integrations/changeTicketStatusPreview", async ({ ticketId, canonicalStatus }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/support-communication/tickets/${ticketId}/status`, { canonicalStatus });
    toast.promise(res, { loading: "Updating status preview...", success: "Status updated in preview", error: "Failed to update the status" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to update the status");
  }
});

export const closeTicketPreview = createAsyncThunk("integrations/closeTicketPreview", async ({ ticketId, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A written reason is required to close a ticket.");
  try {
    const res = mockApi.post(`/admin/integrations/support-communication/tickets/${ticketId}/close`, { reason });
    toast.promise(res, { loading: "Closing ticket preview...", success: "Ticket closed in preview", error: "Failed to close the ticket" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to close the ticket");
  }
});

export const addInternalNotePreviewToTicket = createAsyncThunk("integrations/addInternalNotePreviewToTicket", async ({ ticketId, message }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/support-communication/tickets/${ticketId}/note`, { message });
    toast.promise(res, { loading: "Saving internal note preview...", success: "Internal note preview added", error: "Failed to add the note" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to add the note");
  }
});

export const retryTicketSyncPreview = createAsyncThunk("integrations/retryTicketSyncPreview", async (ticketId, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/support-communication/tickets/${ticketId}/retry-sync`);
    toast.promise(res, { loading: "Retrying synchronization preview...", success: "Synchronization preview retried", error: "Failed to retry the synchronization" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to retry the synchronization");
  }
});

export const linkCustomerToTicket = createAsyncThunk("integrations/linkCustomerToTicket", async ({ ticketId, contactId, contactName }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/support-communication/tickets/${ticketId}/link-customer`, { contactId, contactName });
    toast.promise(res, { loading: "Linking customer...", success: "Customer linked", error: "Failed to link the customer" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to link the customer");
  }
});

export const fetchTicketIdentityMatch = createAsyncThunk("integrations/fetchTicketIdentityMatch", async (ticketId, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get(`/admin/integrations/support-communication/tickets/${ticketId}/identity-match`);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load the identity match");
  }
});

export const fetchSupportQueueMappings = createAsyncThunk("integrations/fetchSupportQueueMappings", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/support-communication/channels/queue-mappings", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load queue mappings");
  }
});

export const fetchSupportAgentMappings = createAsyncThunk("integrations/fetchSupportAgentMappings", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/support-communication/channels/agent-mappings", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load agent mappings");
  }
});

export const fetchSupportSlaConfigurations = createAsyncThunk("integrations/fetchSupportSlaConfigurations", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/support-communication/sla", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load SLA configurations");
  }
});

export const fetchSupportEscalationRules = createAsyncThunk("integrations/fetchSupportEscalationRules", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/support-communication/sla/escalations", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load escalation rules");
  }
});

export const previewSupportEscalation = createAsyncThunk("integrations/previewSupportEscalation", async ({ ruleId, ticketId }, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get(`/admin/integrations/support-communication/sla/escalations/${ruleId}/preview`, { params: { ticketId } });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to preview the escalation");
  }
});

export const fetchSupportCalls = createAsyncThunk("integrations/fetchSupportCalls", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/support-communication/telephony", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load calls");
  }
});

export const createCallFollowUpActivity = createAsyncThunk("integrations/createCallFollowUpActivity", async (callId, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/support-communication/telephony/${callId}/follow-up`);
    toast.promise(res, { loading: "Creating follow-up Activity preview...", success: "Follow-up Activity preview created", error: "Failed to create the follow-up Activity preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to create the follow-up Activity preview");
  }
});

export const fetchSupportReviews = createAsyncThunk("integrations/fetchSupportReviews", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/support-communication/channels/reviews", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load reviews");
  }
});

export const draftSupportReviewReply = createAsyncThunk("integrations/draftSupportReviewReply", async ({ reviewId, draftText }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/support-communication/channels/reviews/${reviewId}/draft-reply`, { draftText });
    toast.promise(res, { loading: "Saving reply draft...", success: "Reply draft saved — never automatically posted", error: "Failed to save the reply draft" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to save the reply draft");
  }
});

// ---------------------------------------------------------------------------
// Projects and Development Integrations (Phase 4) — same shared slice,
// extended again rather than forked, exactly like Phase 2/3 before it.
// ---------------------------------------------------------------------------
export const fetchProjectsDevelopmentOverviewMetrics = createAsyncThunk("integrations/fetchProjectsDevelopmentOverviewMetrics", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/projects-development/overview-metrics", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load overview metrics");
  }
});

export const fetchWonDealsReadyForProject = createAsyncThunk("integrations/fetchWonDealsReadyForProject", async (_, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/projects-development/won-deals");
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load Won Deals");
  }
});

export const fetchExternalProjectLinks = createAsyncThunk("integrations/fetchExternalProjectLinks", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/projects-development/project-links", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load linked Projects");
  }
});

export const previewCreateProjectFromWonDeal = createAsyncThunk("integrations/previewCreateProjectFromWonDeal", async ({ dealId, templateId, teamId, deliveryOwnerId }, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get(`/admin/integrations/projects-development/won-deals/${dealId}/preview`, { params: { templateId, teamId, deliveryOwnerId } });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to preview the Project");
  }
});

export const createProjectFromWonDeal = createAsyncThunk("integrations/createProjectFromWonDeal", async ({ dealId, templateId, teamId, deliveryOwnerId }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/projects-development/won-deals/${dealId}/create`, { templateId, teamId, deliveryOwnerId });
    toast.promise(res, { loading: "Creating Project preview...", success: "Project preview created", error: "Failed to create the Project preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to create the Project preview");
  }
});

export const undoWonDealProject = createAsyncThunk("integrations/undoWonDealProject", async (_, { rejectWithValue }) => {
  try {
    const res = mockApi.post("/admin/integrations/projects-development/won-deals/undo");
    toast.promise(res, { loading: "Undoing...", success: "Project preview creation undone", error: "Failed to undo" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to undo");
  }
});

export const unlinkExternalProject = createAsyncThunk("integrations/unlinkExternalProject", async ({ linkId, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A written reason is required to unlink an external Project.");
  try {
    const res = mockApi.post(`/admin/integrations/projects-development/project-links/${linkId}/unlink`, { reason });
    toast.promise(res, { loading: "Unlinking...", success: "External Project unlinked", error: "Failed to unlink the external Project" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to unlink the external Project");
  }
});

export const pauseExternalProjectLink = createAsyncThunk("integrations/pauseExternalProjectLink", async ({ linkId, paused }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/projects-development/project-links/${linkId}/pause`, { paused });
    toast.promise(res, { loading: paused ? "Pausing preview..." : "Resuming preview...", success: paused ? "Preview paused" : "Preview resumed", error: "Failed to update the preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to update the preview");
  }
});

export const previewProjectSyncRun = createAsyncThunk("integrations/previewProjectSyncRun", async (linkId, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/projects-development/project-links/${linkId}/sync`);
    toast.promise(res, { loading: "Running preview synchronization...", success: "Preview synchronization complete", error: "Failed to run the preview synchronization" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to run the preview synchronization");
  }
});

export const fetchWorkItemPreviews = createAsyncThunk("integrations/fetchWorkItemPreviews", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/projects-development/work-items", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load work items");
  }
});

export const retryWorkItemSync = createAsyncThunk("integrations/retryWorkItemSync", async (workItemId, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/projects-development/work-items/${workItemId}/retry`);
    toast.promise(res, { loading: "Retrying...", success: "Work item preview retried", error: "Failed to retry" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to retry");
  }
});

export const fetchProjectMappings = createAsyncThunk("integrations/fetchProjectMappings", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/projects-development/mappings", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load mappings");
  }
});

export const fetchRepositories = createAsyncThunk("integrations/fetchRepositories", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/projects-development/development/repositories", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load repositories");
  }
});

export const fetchDevelopmentIssues = createAsyncThunk("integrations/fetchDevelopmentIssues", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/projects-development/development/issues", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load development issues");
  }
});

export const createDevelopmentIssueFromTicket = createAsyncThunk("integrations/createDevelopmentIssueFromTicket", async ({ ticketId, providerKey, repositoryId, type, priority, assignee, labels }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/projects-development/development/issues/from-ticket/${ticketId}`, { providerKey, repositoryId, type, priority, assignee, labels });
    toast.promise(res, { loading: "Creating development issue preview...", success: "Development issue preview created", error: "Failed to create the development issue preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to create the development issue preview");
  }
});

export const fetchCodeReviews = createAsyncThunk("integrations/fetchCodeReviews", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/projects-development/development/code-reviews", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load code reviews");
  }
});

export const fetchPipelineRuns = createAsyncThunk("integrations/fetchPipelineRuns", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/projects-development/development/pipelines", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load pipeline runs");
  }
});

export const fetchDeployments = createAsyncThunk("integrations/fetchDeployments", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/projects-development/development/deployments", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load deployments");
  }
});

export const fetchReleases = createAsyncThunk("integrations/fetchReleases", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/projects-development/development/releases", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load releases");
  }
});

export const fetchDeliveryHealthIndicators = createAsyncThunk("integrations/fetchDeliveryHealthIndicators", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/projects-development/delivery-health", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load delivery-health indicators");
  }
});

export const fetchProjectSyncConflicts = createAsyncThunk("integrations/fetchProjectSyncConflicts", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/projects-development/conflicts", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load synchronization conflicts");
  }
});

export const resolveProjectSyncConflict = createAsyncThunk("integrations/resolveProjectSyncConflict", async ({ conflictId, resolution }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/projects-development/conflicts/${conflictId}/resolve`, { resolution });
    toast.promise(res, { loading: "Resolving conflict...", success: "Conflict resolved", error: "Failed to resolve the conflict" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to resolve the conflict");
  }
});

// ---------------------------------------------------------------------------
// Administration: Commerce and Finance Integrations (Phase 5, frontend-only
// preview) — same frontend-only boundary as the four blocks above. URL
// suffixes were checked against the axios-mock-adapter collision Phase 4
// had to fix (real /sales/orders, /sales/products, /sales/quotes,
// /finance/invoices etc. routes) — every Phase 5 path below carries the
// full "/admin/integrations/commerce-finance/..." prefix, which none of
// those real routes share, so no collision is possible.
// ---------------------------------------------------------------------------
export const fetchCommerceFinanceOverviewMetrics = createAsyncThunk("integrations/fetchCommerceFinanceOverviewMetrics", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/commerce-finance/overview-metrics", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load overview metrics");
  }
});

export const fetchCommerceStores = createAsyncThunk("integrations/fetchCommerceStores", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/commerce-finance/stores", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load stores");
  }
});

export const pauseCommerceStore = createAsyncThunk("integrations/pauseCommerceStore", async ({ storeId, paused }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/commerce-finance/stores/${storeId}/pause`, { paused });
    toast.promise(res, { loading: paused ? "Pausing preview..." : "Resuming preview...", success: paused ? "Preview paused" : "Preview resumed", error: "Failed to update the preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to update the preview");
  }
});

export const previewCommerceStoreSyncRun = createAsyncThunk("integrations/previewCommerceStoreSyncRun", async (storeId, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/commerce-finance/stores/${storeId}/sync`);
    toast.promise(res, { loading: "Running preview synchronization...", success: "Preview synchronization complete", error: "Failed to run the preview synchronization" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to run the preview synchronization");
  }
});

export const fetchCommerceCustomerMappings = createAsyncThunk("integrations/fetchCommerceCustomerMappings", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/commerce-finance/customer-mappings", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load customer mappings");
  }
});

export const fetchCommerceProductMappings = createAsyncThunk("integrations/fetchCommerceProductMappings", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/commerce-finance/product-mappings", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load product mappings");
  }
});

export const fetchCommerceOrders = createAsyncThunk("integrations/fetchCommerceOrders", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/commerce-finance/orders", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load orders");
  }
});

export const previewCommerceOrderSyncRun = createAsyncThunk("integrations/previewCommerceOrderSyncRun", async (orderId, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/commerce-finance/orders/${orderId}/sync`);
    toast.promise(res, { loading: "Running preview synchronization...", success: "Preview synchronization complete", error: "Failed to run the preview synchronization" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to run the preview synchronization");
  }
});

export const fetchCommerceReturns = createAsyncThunk("integrations/fetchCommerceReturns", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/commerce-finance/returns", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load returns");
  }
});

export const fetchPaymentTransactions = createAsyncThunk("integrations/fetchPaymentTransactions", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/commerce-finance/payment-transactions", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load payment transactions");
  }
});

export const fetchRefundPreviews = createAsyncThunk("integrations/fetchRefundPreviews", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/commerce-finance/refunds", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load refund previews");
  }
});

export const approveRefundPreview = createAsyncThunk("integrations/approveRefundPreview", async ({ refundId, approverName }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/commerce-finance/refunds/${refundId}/approve`, { approverName });
    toast.promise(res, { loading: "Approving refund preview...", success: "Refund preview approved", error: "Failed to approve the refund preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to approve the refund preview");
  }
});

export const fetchDisputePreviews = createAsyncThunk("integrations/fetchDisputePreviews", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/commerce-finance/disputes", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load disputes");
  }
});

export const fetchPayoutReferences = createAsyncThunk("integrations/fetchPayoutReferences", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/commerce-finance/payouts", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load payouts");
  }
});

export const fetchAccountingMappings = createAsyncThunk("integrations/fetchAccountingMappings", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/commerce-finance/accounting-mappings", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load accounting mappings");
  }
});

export const overrideLedgerMapping = createAsyncThunk("integrations/overrideLedgerMapping", async ({ mappingId, newLedgerAccount, requesterName, approverName }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/commerce-finance/accounting-mappings/ledger/${mappingId}/override`, { newLedgerAccount, requesterName, approverName });
    toast.promise(res, { loading: "Overriding ledger mapping...", success: "Ledger mapping overridden", error: "Failed to override the ledger mapping" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to override the ledger mapping");
  }
});

export const approveCreditNotePreview = createAsyncThunk("integrations/approveCreditNotePreview", async ({ creditNoteId, approverName, requestedBy }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/commerce-finance/accounting-mappings/credit-notes/${creditNoteId}/approve`, { approverName, requestedBy });
    toast.promise(res, { loading: "Approving credit note preview...", success: "Credit note preview approved", error: "Failed to approve the credit note preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to approve the credit note preview");
  }
});

export const fetchFinancialSyncConflicts = createAsyncThunk("integrations/fetchFinancialSyncConflicts", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/commerce-finance/conflicts", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load synchronization conflicts");
  }
});

export const resolveFinancialSyncConflict = createAsyncThunk("integrations/resolveFinancialSyncConflict", async ({ conflictId, resolution }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/commerce-finance/conflicts/${conflictId}/resolve`, { resolution });
    toast.promise(res, { loading: "Resolving conflict...", success: "Conflict resolved", error: "Failed to resolve the conflict" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to resolve the conflict");
  }
});

export const fetchSubscriptions = createAsyncThunk("integrations/fetchSubscriptions", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/commerce-finance/subscriptions", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load subscriptions");
  }
});

export const pauseSubscriptionPreview = createAsyncThunk("integrations/pauseSubscriptionPreview", async (subscriptionId, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/commerce-finance/subscriptions/${subscriptionId}/pause`);
    toast.promise(res, { loading: "Pausing preview...", success: "Preview paused", error: "Failed to pause the preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to pause the preview");
  }
});

export const cancelSubscriptionPreview = createAsyncThunk("integrations/cancelSubscriptionPreview", async ({ subscriptionId, requesterName, approverName }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/commerce-finance/subscriptions/${subscriptionId}/cancel`, { requesterName, approverName });
    toast.promise(res, { loading: "Cancelling preview...", success: "Subscription preview cancelled", error: "Failed to cancel the preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to cancel the preview");
  }
});

export const linkSubscriptionContract = createAsyncThunk("integrations/linkSubscriptionContract", async ({ subscriptionId, contractId }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/commerce-finance/subscriptions/${subscriptionId}/link-contract`, { contractId });
    toast.promise(res, { loading: "Linking Contract...", success: "Contract linked", error: "Failed to link the Contract" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to link the Contract");
  }
});

export const fetchBankAccounts = createAsyncThunk("integrations/fetchBankAccounts", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/commerce-finance/bank-accounts", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load bank accounts");
  }
});

export const fetchBankTransactions = createAsyncThunk("integrations/fetchBankTransactions", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/commerce-finance/bank-transactions", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load bank transactions");
  }
});

export const confirmReconciliationMatch = createAsyncThunk("integrations/confirmReconciliationMatch", async (bankTransactionId, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/commerce-finance/reconciliation/${bankTransactionId}/confirm`);
    toast.promise(res, { loading: "Confirming preview match...", success: "Preview match confirmed", error: "Failed to confirm the preview match" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to confirm the preview match");
  }
});

export const rejectReconciliationSuggestion = createAsyncThunk("integrations/rejectReconciliationSuggestion", async (bankTransactionId, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/commerce-finance/reconciliation/${bankTransactionId}/reject`);
    toast.promise(res, { loading: "Rejecting suggestion...", success: "Suggestion rejected", error: "Failed to reject the suggestion" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to reject the suggestion");
  }
});

export const markReconciliationReviewRequired = createAsyncThunk("integrations/markReconciliationReviewRequired", async (bankTransactionId, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/commerce-finance/reconciliation/${bankTransactionId}/review-required`);
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to mark the transaction for review");
  }
});

export const undoLastReconciliationMatch = createAsyncThunk("integrations/undoLastReconciliationMatch", async (_, { rejectWithValue }) => {
  try {
    const res = mockApi.post("/admin/integrations/commerce-finance/reconciliation/undo");
    toast.promise(res, { loading: "Undoing...", success: "Match undone", error: "Failed to undo" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to undo");
  }
});

// ---------------------------------------------------------------------------
// Administration: Documents, Storage and Electronic Signature Integrations
// (Phase 6, frontend-only preview) — same frontend-only boundary as the five
// blocks above. Every URL carries the full "/admin/integrations/documents-
// storage/..." prefix, which no real route shares.
// ---------------------------------------------------------------------------
export const fetchDocumentsStorageOverviewMetrics = createAsyncThunk("integrations/fetchDocumentsStorageOverviewMetrics", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/documents-storage/overview-metrics", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load overview metrics");
  }
});

export const fetchExternalFolders = createAsyncThunk("integrations/fetchExternalFolders", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/documents-storage/folders", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load folders");
  }
});

export const fetchExternalFiles = createAsyncThunk("integrations/fetchExternalFiles", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/documents-storage/files", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load files");
  }
});

export const unlinkExternalFile = createAsyncThunk("integrations/unlinkExternalFile", async ({ fileId, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A written reason is required to unlink a file preview.");
  try {
    const res = mockApi.post(`/admin/integrations/documents-storage/files/${fileId}/unlink`, { reason });
    toast.promise(res, { loading: "Unlinking...", success: "File preview unlinked", error: "Failed to unlink the file preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to unlink the file preview");
  }
});

export const fetchFileAssociations = createAsyncThunk("integrations/fetchFileAssociations", async (fileId, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get(`/admin/integrations/documents-storage/files/${fileId}/associations`);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load associations");
  }
});

export const associateFilePreview = createAsyncThunk("integrations/associateFilePreview", async (payload, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/documents-storage/files/${payload.fileId}/associate`, payload);
    toast.promise(res, { loading: "Associating file preview...", success: "File preview associated", error: "Failed to associate the file preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to associate the file preview");
  }
});

export const undoLastAssociation = createAsyncThunk("integrations/undoLastAssociation", async (_, { rejectWithValue }) => {
  try {
    const res = mockApi.post("/admin/integrations/documents-storage/files/associations/undo");
    toast.promise(res, { loading: "Undoing...", success: "Association undone", error: "Failed to undo" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to undo");
  }
});

export const fetchFolderMappings = createAsyncThunk("integrations/fetchFolderMappings", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/documents-storage/folder-mappings", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load folder mappings");
  }
});

export const fetchDocumentSyncConflicts = createAsyncThunk("integrations/fetchDocumentSyncConflicts", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/documents-storage/conflicts", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load synchronization conflicts");
  }
});

export const resolveDocumentSyncConflict = createAsyncThunk("integrations/resolveDocumentSyncConflict", async ({ conflictId, resolution }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/documents-storage/conflicts/${conflictId}/resolve`, { resolution });
    toast.promise(res, { loading: "Resolving conflict...", success: "Conflict resolved", error: "Failed to resolve the conflict" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to resolve the conflict");
  }
});

export const fetchAccessReviewFindings = createAsyncThunk("integrations/fetchAccessReviewFindings", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/documents-storage/access-review", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load access-review findings");
  }
});

export const fetchRetentionPolicies = createAsyncThunk("integrations/fetchRetentionPolicies", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/documents-storage/retention-policies", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load retention policies");
  }
});

export const fetchLegalHolds = createAsyncThunk("integrations/fetchLegalHolds", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/documents-storage/legal-holds", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load legal holds");
  }
});

export const removeLegalHold = createAsyncThunk("integrations/removeLegalHold", async ({ holdId, reason, requesterName, approverName }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/documents-storage/legal-holds/${holdId}/remove`, { reason, requesterName, approverName });
    toast.promise(res, { loading: "Removing legal hold...", success: "Legal hold removed", error: "Failed to remove the legal hold" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to remove the legal hold");
  }
});

export const fetchSignatureTemplates = createAsyncThunk("integrations/fetchSignatureTemplates", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/documents-storage/signature-templates", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load signature templates");
  }
});

export const fetchSignatureEnvelopes = createAsyncThunk("integrations/fetchSignatureEnvelopes", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/documents-storage/signatures", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load signature workflows");
  }
});

export const createSignatureWorkflowPreview = createAsyncThunk("integrations/createSignatureWorkflowPreview", async (draft, { rejectWithValue }) => {
  try {
    const res = mockApi.post("/admin/integrations/documents-storage/signatures", draft);
    toast.promise(res, { loading: "Creating signature workflow preview...", success: "Signature workflow preview created", error: "Failed to create the signature workflow preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    // Preserve the full validation payload (error + checks[]) rather than
    // collapsing it to a generic string — the creation form's validation
    // summary needs the per-check pass/fail detail, not just a message.
    return rejectWithValue(error.response?.data || { error: "Failed to create the signature workflow preview" });
  }
});

export const markSignatureWorkflowReady = createAsyncThunk("integrations/markSignatureWorkflowReady", async (envelopeId, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/documents-storage/signatures/${envelopeId}/ready`);
    toast.promise(res, { loading: "Preparing for send...", success: "Workflow ready for Send Preview", error: "Failed to prepare the workflow" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to prepare the workflow");
  }
});

export const sendSignatureWorkflowPreview = createAsyncThunk("integrations/sendSignatureWorkflowPreview", async (envelopeId, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/documents-storage/signatures/${envelopeId}/send`);
    toast.promise(res, { loading: "Confirming Send Preview...", success: "Signature workflow preview created. No request was sent to the provider or recipient.", error: "Failed to send the preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to send the preview");
  }
});

export const remindSignatureWorkflowPreview = createAsyncThunk("integrations/remindSignatureWorkflowPreview", async (envelopeId, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/documents-storage/signatures/${envelopeId}/remind`);
    toast.promise(res, { loading: "Sending Reminder Preview...", success: "Reminder preview recorded", error: "Failed to send the reminder preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to send the reminder preview");
  }
});

export const voidSignatureWorkflowPreview = createAsyncThunk("integrations/voidSignatureWorkflowPreview", async ({ envelopeId, reason }, { rejectWithValue }) => {
  if (!reason?.trim()) return rejectWithValue("A written reason is required to void a signature workflow.");
  try {
    const res = mockApi.post(`/admin/integrations/documents-storage/signatures/${envelopeId}/void`, { reason });
    toast.promise(res, { loading: "Voiding preview...", success: "Signature workflow preview voided", error: "Failed to void the workflow preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to void the workflow preview");
  }
});

// ---------------------------------------------------------------------------
// Administration: AI Provider and Intelligence Integrations (Phase 7, final —
// frontend-only preview). Every URL carries the full "/admin/integrations/
// ai-providers/..." prefix. This block is entirely separate from src/redux/
// ai/aiSlice.js, aiExploreSlice.js and aiCopilotSlice.js (the real AI
// gateway) — it never dispatches those thunks and never calls
// aiGatewayClient.js.
// ---------------------------------------------------------------------------
export const fetchAiProviderOverviewMetrics = createAsyncThunk("integrations/fetchAiProviderOverviewMetrics", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/ai-providers/overview-metrics", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load overview metrics");
  }
});

export const fetchAiProviderConnections = createAsyncThunk("integrations/fetchAiProviderConnections", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/ai-providers/connections", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load provider connections");
  }
});

export const createAiProviderConnectionPreview = createAsyncThunk("integrations/createAiProviderConnectionPreview", async (draft, { rejectWithValue }) => {
  try {
    const res = mockApi.post("/admin/integrations/ai-providers/connections", draft);
    toast.promise(res, { loading: "Preparing provider preview...", success: "Provider preview configured. No provider account was contacted and no credential was stored.", error: "Failed to configure the provider preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to configure the provider preview");
  }
});

export const pauseAiProviderConnectionPreview = createAsyncThunk("integrations/pauseAiProviderConnectionPreview", async ({ connectionId, paused }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/ai-providers/connections/${connectionId}/pause`, { paused });
    toast.promise(res, { loading: "Updating connection preview...", success: paused ? "Connection preview paused" : "Connection preview resumed", error: "Failed to update the connection preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to update the connection preview");
  }
});

export const fetchAiModelAliases = createAsyncThunk("integrations/fetchAiModelAliases", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/ai-providers/models", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load the model catalog");
  }
});

export const fetchAiUseCases = createAsyncThunk("integrations/fetchAiUseCases", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/ai-providers/use-cases", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load AI use cases");
  }
});

export const fetchAiRoutingPolicies = createAsyncThunk("integrations/fetchAiRoutingPolicies", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/ai-providers/routing", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load routing policies");
  }
});

export const updateAiRoutingPolicyPreview = createAsyncThunk("integrations/updateAiRoutingPolicyPreview", async ({ policyId, changes }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/ai-providers/routing/${policyId}`, changes);
    toast.promise(res, { loading: "Updating routing policy preview...", success: "Routing policy preview updated", error: "Failed to update the routing policy preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to update the routing policy preview");
  }
});

export const fetchAiPolicies = createAsyncThunk("integrations/fetchAiPolicies", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/ai-providers/policies", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load AI policies");
  }
});

export const updateAiPolicyPreview = createAsyncThunk("integrations/updateAiPolicyPreview", async ({ policyId, changes }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/ai-providers/policies/${policyId}`, changes);
    toast.promise(res, { loading: "Updating policy preview...", success: "Policy preview updated", error: "Failed to update the policy preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to update the policy preview");
  }
});

export const fetchAiRedactionRules = createAsyncThunk("integrations/fetchAiRedactionRules", async (_, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/ai-providers/privacy/redaction");
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load redaction rules");
  }
});

export const fetchAiContextAssemblyPreview = createAsyncThunk("integrations/fetchAiContextAssemblyPreview", async ({ useCaseId, organizationId }, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/ai-providers/privacy/context-preview", { params: { useCaseId, organizationId } });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load the context-assembly preview");
  }
});

export const fetchAiUsageEstimates = createAsyncThunk("integrations/fetchAiUsageEstimates", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/ai-providers/usage", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load usage estimates");
  }
});

export const fetchAiBudgetPolicies = createAsyncThunk("integrations/fetchAiBudgetPolicies", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/ai-providers/usage/budgets", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load budget policies");
  }
});

export const updateAiBudgetPolicyPreview = createAsyncThunk("integrations/updateAiBudgetPolicyPreview", async ({ budgetId, changes }, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/ai-providers/usage/budgets/${budgetId}`, changes);
    toast.promise(res, { loading: "Updating budget preview...", success: "Budget policy preview updated", error: "Failed to update the budget preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to update the budget preview");
  }
});

export const fetchAiEvaluationScenarios = createAsyncThunk("integrations/fetchAiEvaluationScenarios", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/ai-providers/evaluations", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load evaluation scenarios");
  }
});

export const runAiEvaluationScenarioPreview = createAsyncThunk("integrations/runAiEvaluationScenarioPreview", async (scenarioId, { rejectWithValue }) => {
  try {
    const res = mockApi.post(`/admin/integrations/ai-providers/evaluations/${scenarioId}/run`);
    toast.promise(res, { loading: "Running evaluation preview...", success: "Evaluation preview run recorded", error: "Failed to run the evaluation preview" });
    const { data } = await res;
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to run the evaluation preview");
  }
});

export const fetchAiAuditEvents = createAsyncThunk("integrations/fetchAiAuditEvents", async (filters, { rejectWithValue }) => {
  try {
    const { data } = await mockApi.get("/admin/integrations/ai-providers/audit", { params: filters || {} });
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || "Failed to load AI audit events");
  }
});

const initialState = {
  organizations: [],
  providers: [],
  providerCounts: null,
  currentProvider: null,
  connections: [],
  connectionCounts: null,
  currentConnection: null,
  activity: [],
  webhooks: [],
  wizardDraft: null, // session-only, cleared on completion/cancel — never localStorage
  lastDisconnectedId: null, // enables the session-only "Undo" affordance
  loading: false,
  error: null,
  // Sales & Marketing Integrations (Phase 2)
  leadCaptureEvents: [],
  lastLeadCaptureUndo: null, // session-only, mirrors lastDisconnectedId's Undo affordance
  audiences: [],
  currentAudienceEligibility: null,
  suppressionEntries: [],
  emailDeliveryEvents: [],
  attribution: null,
  formConnections: [],
  salesMarketingOverviewMetrics: null,
  marketingConsentSummary: null,
  // Customer Support and Communication Integrations (Phase 3)
  supportOverviewMetrics: null,
  supportChannels: [],
  supportConversations: [],
  currentConversation: null,
  currentIdentityMatch: null,
  supportTicketPreviews: [],
  supportSyncConflicts: [],
  supportQueueMappings: [],
  supportAgentMappings: [],
  supportSlaConfigurations: [],
  supportEscalationRules: [],
  currentEscalationPreview: null,
  supportCalls: [],
  supportReviews: [],
  // Projects and Development Integrations (Phase 4)
  projectsDevelopmentOverviewMetrics: null,
  wonDealsReadyForProject: [],
  currentProjectFromWonDealPreview: null,
  lastWonDealProjectUndo: null, // session-only, mirrors lastLeadCaptureUndo's Undo affordance
  externalProjectLinks: [],
  workItemPreviews: [],
  projectMappings: null,
  repositories: [],
  developmentIssues: [],
  codeReviews: [],
  pipelineRuns: [],
  deployments: [],
  releases: [],
  deliveryHealthIndicators: [],
  projectSyncConflicts: [],
  // Commerce and Finance Integrations (Phase 5)
  commerceFinanceOverviewMetrics: null,
  commerceStores: [],
  commerceCustomerMappings: [],
  commerceProductMappings: [],
  commerceOrders: [],
  commerceReturns: [],
  paymentTransactions: [],
  refundPreviews: [],
  disputePreviews: [],
  payoutReferences: [],
  accountingMappings: null,
  financialSyncConflicts: [],
  subscriptions: [],
  bankAccounts: [],
  bankTransactions: [],
  // Documents, Storage and Electronic Signature Integrations (Phase 6)
  documentsStorageOverviewMetrics: null,
  externalFolders: [],
  externalFiles: [],
  currentFileAssociations: [],
  lastAssociationUndo: null, // session-only, mirrors lastWonDealProjectUndo's Undo affordance
  folderMappings: [],
  documentSyncConflicts: [],
  accessReviewFindings: [],
  retentionPolicies: [],
  legalHolds: [],
  signatureTemplates: [],
  signatureEnvelopes: [],
  // AI Provider and Intelligence Integrations (Phase 7, final)
  aiProviderOverviewMetrics: null,
  aiProviderConnections: [],
  aiModelAliases: [],
  aiUseCases: [],
  aiRoutingPolicies: [],
  aiPolicies: [],
  aiRedactionRules: [],
  currentAiContextAssemblyPreview: null,
  aiUsageEstimates: [],
  aiBudgetPolicies: [],
  aiEvaluationScenarios: [],
  aiAuditEvents: [],
};

function applyConnection(state, action) {
  const updated = action.payload?.connection;
  if (!updated) return;
  const idx = state.connections.findIndex((c) => c.id === updated.id);
  if (idx >= 0) state.connections[idx] = updated;
  else state.connections.unshift(updated);
  if (state.currentConnection?.id === updated.id) state.currentConnection = updated;
}

function applyLeadCaptureEvent(state, updated) {
  if (!updated) return;
  const idx = state.leadCaptureEvents.findIndex((e) => e.id === updated.id);
  if (idx >= 0) state.leadCaptureEvents[idx] = updated;
  else state.leadCaptureEvents.unshift(updated);
}

function applyEmailDeliveryEvent(state, updated) {
  if (!updated) return;
  const idx = state.emailDeliveryEvents.findIndex((e) => e.id === updated.id);
  if (idx >= 0) state.emailDeliveryEvents[idx] = updated;
}

function applyConversation(state, updated) {
  if (!updated) return;
  const idx = state.supportConversations.findIndex((c) => c.id === updated.id);
  if (idx >= 0) state.supportConversations[idx] = updated;
  else state.supportConversations.unshift(updated);
  if (state.currentConversation?.id === updated.id) state.currentConversation = updated;
}

function applySyncConflict(state, updated) {
  if (!updated) return;
  const idx = state.supportSyncConflicts.findIndex((c) => c.id === updated.id);
  if (idx >= 0) state.supportSyncConflicts[idx] = updated;
}

function applyCall(state, updated) {
  if (!updated) return;
  const idx = state.supportCalls.findIndex((c) => c.id === updated.id);
  if (idx >= 0) state.supportCalls[idx] = updated;
}

function applyReview(state, updated) {
  if (!updated) return;
  const idx = state.supportReviews.findIndex((r) => r.id === updated.id);
  if (idx >= 0) state.supportReviews[idx] = updated;
}

const integrationsSlice = createSlice({
  name: "integrations",
  initialState,
  reducers: {
    setWizardDraft(state, action) {
      state.wizardDraft = action.payload;
    },
    clearWizardDraft(state) {
      state.wizardDraft = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchOrganizations.fulfilled, (state, action) => {
        state.organizations = action.payload?.organizations || [];
      })
      .addCase(fetchProviders.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchProviders.fulfilled, (state, action) => {
        state.loading = false;
        state.providers = action.payload?.providers || [];
        state.providerCounts = action.payload?.counts || null;
      })
      .addCase(fetchProviders.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchProvider.fulfilled, (state, action) => {
        state.currentProvider = action.payload?.provider || null;
      })
      .addCase(fetchConnections.fulfilled, (state, action) => {
        state.connections = action.payload?.connections || [];
        state.connectionCounts = action.payload?.counts || null;
      })
      .addCase(fetchConnection.fulfilled, (state, action) => {
        state.currentConnection = action.payload?.connection || null;
      })
      .addCase(createConnectionPreview.fulfilled, (state, action) => {
        if (action.payload?.connection) state.connections.unshift(action.payload.connection);
        state.wizardDraft = null;
      })
      .addCase(disconnectConnection.fulfilled, (state, action) => {
        applyConnection(state, action);
        state.lastDisconnectedId = action.payload?.connection?.id || null;
      })
      .addCase(undoDisconnectConnection.fulfilled, (state, action) => {
        applyConnection(state, action);
        state.lastDisconnectedId = null;
      })
      .addCase(updateFieldMapping.fulfilled, (state, action) => {
        const { connectionId, fieldMapping } = action.payload || {};
        if (!fieldMapping || state.currentConnection?.id !== connectionId) return;
        const idx = state.currentConnection.fieldMappings.findIndex((m) => m.id === fieldMapping.id);
        if (idx >= 0) state.currentConnection.fieldMappings[idx] = fieldMapping;
      })
      .addCase(fetchActivity.fulfilled, (state, action) => {
        state.activity = action.payload?.events || [];
      })
      .addCase(fetchWebhooks.fulfilled, (state, action) => {
        state.webhooks = action.payload?.webhooks || [];
      })
      .addCase(fetchLeadCaptureEvents.fulfilled, (state, action) => {
        state.leadCaptureEvents = action.payload?.events || [];
      })
      .addCase(createLeadFromCapture.fulfilled, (state, action) => {
        applyLeadCaptureEvent(state, action.payload?.event);
      })
      .addCase(rejectLeadCapture.fulfilled, (state, action) => {
        applyLeadCaptureEvent(state, action.payload?.event);
        state.lastLeadCaptureUndo = action.payload?.event?.id || null;
      })
      .addCase(retryLeadCaptureProcessing.fulfilled, (state, action) => {
        applyLeadCaptureEvent(state, action.payload?.event);
      })
      .addCase(fetchAudiences.fulfilled, (state, action) => {
        state.audiences = action.payload?.audiences || [];
      })
      .addCase(fetchSuppressionEntries.fulfilled, (state, action) => {
        state.suppressionEntries = action.payload?.entries || [];
      })
      .addCase(removeSuppressionEntry.fulfilled, (state, action) => {
        state.suppressionEntries = state.suppressionEntries.filter((s) => s.id !== action.payload?.entryId);
      })
      .addCase(fetchEmailDeliveryEvents.fulfilled, (state, action) => {
        state.emailDeliveryEvents = action.payload?.events || [];
      })
      .addCase(retryEmailDelivery.fulfilled, (state, action) => {
        applyEmailDeliveryEvent(state, action.payload?.event);
      })
      .addCase(fetchAttribution.fulfilled, (state, action) => {
        state.attribution = action.payload?.summary || null;
      })
      .addCase(fetchFormConnections.fulfilled, (state, action) => {
        state.formConnections = action.payload?.forms || [];
      })
      .addCase(updateSalesMarketingFormFieldMapping.fulfilled, (state, action) => {
        const { formConnectionId, fieldMapping } = action.payload || {};
        const form = state.formConnections.find((f) => f.id === formConnectionId);
        if (!form || !fieldMapping) return;
        const idx = form.fieldMappings.findIndex((m) => m.id === fieldMapping.id);
        if (idx >= 0) form.fieldMappings[idx] = fieldMapping;
      })
      .addCase(enableFormConnection.fulfilled, (state, action) => {
        const updated = action.payload?.form;
        if (!updated) return;
        const idx = state.formConnections.findIndex((f) => f.id === updated.id);
        if (idx >= 0) state.formConnections[idx] = updated;
      })
      .addCase(fetchSalesMarketingOverviewMetrics.fulfilled, (state, action) => {
        state.salesMarketingOverviewMetrics = action.payload?.metrics || null;
      })
      .addCase(fetchAudienceEligibility.fulfilled, (state, action) => {
        state.currentAudienceEligibility = action.payload || null;
      })
      .addCase(fetchMarketingConsentSummary.fulfilled, (state, action) => {
        state.marketingConsentSummary = action.payload?.summary || null;
      })
      .addCase(checkLeadCaptureDuplicates.fulfilled, (state, action) => {
        const updated = action.payload?.event;
        if (!updated) return;
        const idx = state.leadCaptureEvents.findIndex((e) => e.id === updated.id);
        if (idx >= 0) state.leadCaptureEvents[idx] = updated;
      })
      .addCase(fetchSupportOverviewMetrics.fulfilled, (state, action) => {
        state.supportOverviewMetrics = action.payload?.metrics || null;
      })
      .addCase(fetchSupportChannels.fulfilled, (state, action) => {
        state.supportChannels = action.payload?.channels || [];
      })
      .addCase(fetchSupportConversations.fulfilled, (state, action) => {
        state.supportConversations = action.payload?.conversations || [];
      })
      .addCase(fetchSupportConversation.fulfilled, (state, action) => {
        state.currentConversation = action.payload?.conversation || null;
      })
      .addCase(sendMessagePreview.fulfilled, (state, action) => {
        applyConversation(state, action.payload?.conversation);
      })
      .addCase(undoConversationMessage.fulfilled, (state, action) => {
        applyConversation(state, action.payload?.conversation);
      })
      .addCase(escalateConversationToTicket.fulfilled, (state, action) => {
        applyConversation(state, action.payload?.conversation);
      })
      .addCase(fetchSupportIdentityMatch.fulfilled, (state, action) => {
        state.currentIdentityMatch = action.payload?.match || null;
      })
      .addCase(fetchSupportTicketPreviews.fulfilled, (state, action) => {
        state.supportTicketPreviews = action.payload?.previews || [];
      })
      .addCase(fetchSupportSyncConflicts.fulfilled, (state, action) => {
        state.supportSyncConflicts = action.payload?.conflicts || [];
      })
      .addCase(resolveSupportSyncConflict.fulfilled, (state, action) => {
        applySyncConflict(state, action.payload?.conflict);
      })
      .addCase(fetchTicketIdentityMatch.fulfilled, (state, action) => {
        state.currentIdentityMatch = action.payload?.match || null;
      })
      .addCase(fetchSupportQueueMappings.fulfilled, (state, action) => {
        state.supportQueueMappings = action.payload?.mappings || [];
      })
      .addCase(fetchSupportAgentMappings.fulfilled, (state, action) => {
        state.supportAgentMappings = action.payload?.mappings || [];
      })
      .addCase(fetchSupportSlaConfigurations.fulfilled, (state, action) => {
        state.supportSlaConfigurations = action.payload?.configurations || [];
      })
      .addCase(fetchSupportEscalationRules.fulfilled, (state, action) => {
        state.supportEscalationRules = action.payload?.rules || [];
      })
      .addCase(previewSupportEscalation.fulfilled, (state, action) => {
        state.currentEscalationPreview = action.payload?.preview || null;
      })
      .addCase(fetchSupportCalls.fulfilled, (state, action) => {
        state.supportCalls = action.payload?.calls || [];
      })
      .addCase(createCallFollowUpActivity.fulfilled, (state, action) => {
        applyCall(state, action.payload?.call);
      })
      .addCase(fetchSupportReviews.fulfilled, (state, action) => {
        state.supportReviews = action.payload?.reviews || [];
      })
      .addCase(draftSupportReviewReply.fulfilled, (state, action) => {
        applyReview(state, action.payload?.review);
      })
      .addCase(fetchProjectsDevelopmentOverviewMetrics.fulfilled, (state, action) => {
        state.projectsDevelopmentOverviewMetrics = action.payload?.metrics || null;
      })
      .addCase(fetchWonDealsReadyForProject.fulfilled, (state, action) => {
        state.wonDealsReadyForProject = action.payload?.deals || [];
      })
      .addCase(previewCreateProjectFromWonDeal.fulfilled, (state, action) => {
        state.currentProjectFromWonDealPreview = action.payload?.preview || null;
      })
      .addCase(createProjectFromWonDeal.fulfilled, (state, action) => {
        state.lastWonDealProjectUndo = action.payload?.project?._id ? { projectId: action.payload.project._id } : null;
        state.currentProjectFromWonDealPreview = null;
      })
      .addCase(undoWonDealProject.fulfilled, (state) => {
        state.lastWonDealProjectUndo = null;
      })
      .addCase(fetchExternalProjectLinks.fulfilled, (state, action) => {
        state.externalProjectLinks = action.payload?.links || [];
      })
      .addCase(unlinkExternalProject.fulfilled, (state, action) => {
        const linkId = action.payload?.linkId;
        if (linkId) state.externalProjectLinks = state.externalProjectLinks.filter((l) => l.id !== linkId);
      })
      .addCase(pauseExternalProjectLink.fulfilled, (state, action) => {
        const updated = action.payload?.link;
        if (!updated) return;
        const idx = state.externalProjectLinks.findIndex((l) => l.id === updated.id);
        if (idx >= 0) state.externalProjectLinks[idx] = updated;
      })
      .addCase(previewProjectSyncRun.fulfilled, (state, action) => {
        const updated = action.payload?.link;
        if (!updated) return;
        const idx = state.externalProjectLinks.findIndex((l) => l.id === updated.id);
        if (idx >= 0) state.externalProjectLinks[idx] = updated;
      })
      .addCase(fetchWorkItemPreviews.fulfilled, (state, action) => {
        state.workItemPreviews = action.payload?.items || [];
      })
      .addCase(retryWorkItemSync.fulfilled, (state, action) => {
        const updated = action.payload?.item;
        if (!updated) return;
        const idx = state.workItemPreviews.findIndex((w) => w.id === updated.id);
        if (idx >= 0) state.workItemPreviews[idx] = updated;
      })
      .addCase(fetchProjectMappings.fulfilled, (state, action) => {
        state.projectMappings = action.payload || null;
      })
      .addCase(fetchRepositories.fulfilled, (state, action) => {
        state.repositories = action.payload?.repositories || [];
      })
      .addCase(fetchDevelopmentIssues.fulfilled, (state, action) => {
        state.developmentIssues = action.payload?.issues || [];
      })
      .addCase(createDevelopmentIssueFromTicket.fulfilled, (state, action) => {
        const created = action.payload?.issue;
        if (created) state.developmentIssues.unshift(created);
      })
      .addCase(fetchCodeReviews.fulfilled, (state, action) => {
        state.codeReviews = action.payload?.reviews || [];
      })
      .addCase(fetchPipelineRuns.fulfilled, (state, action) => {
        state.pipelineRuns = action.payload?.runs || [];
      })
      .addCase(fetchDeployments.fulfilled, (state, action) => {
        state.deployments = action.payload?.deployments || [];
      })
      .addCase(fetchReleases.fulfilled, (state, action) => {
        state.releases = action.payload?.releases || [];
      })
      .addCase(fetchDeliveryHealthIndicators.fulfilled, (state, action) => {
        state.deliveryHealthIndicators = action.payload?.indicators || [];
      })
      .addCase(fetchProjectSyncConflicts.fulfilled, (state, action) => {
        state.projectSyncConflicts = action.payload?.conflicts || [];
      })
      .addCase(resolveProjectSyncConflict.fulfilled, (state, action) => {
        const updated = action.payload?.conflict;
        if (!updated) return;
        const idx = state.projectSyncConflicts.findIndex((c) => c.id === updated.id);
        if (idx >= 0) state.projectSyncConflicts[idx] = updated;
      })
      .addCase(fetchCommerceFinanceOverviewMetrics.fulfilled, (state, action) => {
        state.commerceFinanceOverviewMetrics = action.payload?.metrics || null;
      })
      .addCase(fetchCommerceStores.fulfilled, (state, action) => {
        state.commerceStores = action.payload?.stores || [];
      })
      .addCase(pauseCommerceStore.fulfilled, (state, action) => {
        const updated = action.payload?.store;
        if (!updated) return;
        const idx = state.commerceStores.findIndex((s) => s.id === updated.id);
        if (idx >= 0) state.commerceStores[idx] = updated;
      })
      .addCase(previewCommerceStoreSyncRun.fulfilled, (state, action) => {
        const updated = action.payload?.store;
        if (!updated) return;
        const idx = state.commerceStores.findIndex((s) => s.id === updated.id);
        if (idx >= 0) state.commerceStores[idx] = updated;
      })
      .addCase(fetchCommerceCustomerMappings.fulfilled, (state, action) => {
        state.commerceCustomerMappings = action.payload?.mappings || [];
      })
      .addCase(fetchCommerceProductMappings.fulfilled, (state, action) => {
        state.commerceProductMappings = action.payload?.mappings || [];
      })
      .addCase(fetchCommerceOrders.fulfilled, (state, action) => {
        state.commerceOrders = action.payload?.orders || [];
      })
      .addCase(previewCommerceOrderSyncRun.fulfilled, (state, action) => {
        const updated = action.payload?.order;
        if (!updated) return;
        const idx = state.commerceOrders.findIndex((o) => o.id === updated.id);
        if (idx >= 0) state.commerceOrders[idx] = updated;
      })
      .addCase(fetchCommerceReturns.fulfilled, (state, action) => {
        state.commerceReturns = action.payload?.returns || [];
      })
      .addCase(fetchPaymentTransactions.fulfilled, (state, action) => {
        state.paymentTransactions = action.payload?.transactions || [];
      })
      .addCase(fetchRefundPreviews.fulfilled, (state, action) => {
        state.refundPreviews = action.payload?.refunds || [];
      })
      .addCase(approveRefundPreview.fulfilled, (state, action) => {
        const updated = action.payload?.refund;
        if (!updated) return;
        const idx = state.refundPreviews.findIndex((r) => r.id === updated.id);
        if (idx >= 0) state.refundPreviews[idx] = updated;
      })
      .addCase(fetchDisputePreviews.fulfilled, (state, action) => {
        state.disputePreviews = action.payload?.disputes || [];
      })
      .addCase(fetchPayoutReferences.fulfilled, (state, action) => {
        state.payoutReferences = action.payload?.payouts || [];
      })
      .addCase(fetchAccountingMappings.fulfilled, (state, action) => {
        state.accountingMappings = action.payload || null;
      })
      .addCase(overrideLedgerMapping.fulfilled, (state, action) => {
        const updated = action.payload?.mapping;
        if (!updated || !state.accountingMappings?.ledger) return;
        const idx = state.accountingMappings.ledger.findIndex((m) => m.id === updated.id);
        if (idx >= 0) state.accountingMappings.ledger[idx] = updated;
      })
      .addCase(approveCreditNotePreview.fulfilled, (state, action) => {
        const updated = action.payload?.note;
        if (!updated || !state.accountingMappings?.creditNotes) return;
        const idx = state.accountingMappings.creditNotes.findIndex((n) => n.id === updated.id);
        if (idx >= 0) state.accountingMappings.creditNotes[idx] = updated;
      })
      .addCase(fetchFinancialSyncConflicts.fulfilled, (state, action) => {
        state.financialSyncConflicts = action.payload?.conflicts || [];
      })
      .addCase(resolveFinancialSyncConflict.fulfilled, (state, action) => {
        const updated = action.payload?.conflict;
        if (!updated) return;
        const idx = state.financialSyncConflicts.findIndex((c) => c.id === updated.id);
        if (idx >= 0) state.financialSyncConflicts[idx] = updated;
      })
      .addCase(fetchSubscriptions.fulfilled, (state, action) => {
        state.subscriptions = action.payload?.subscriptions || [];
      })
      .addCase(pauseSubscriptionPreview.fulfilled, (state, action) => {
        const updated = action.payload?.sub;
        if (!updated) return;
        const idx = state.subscriptions.findIndex((s) => s.id === updated.id);
        if (idx >= 0) state.subscriptions[idx] = updated;
      })
      .addCase(cancelSubscriptionPreview.fulfilled, (state, action) => {
        const updated = action.payload?.sub;
        if (!updated) return;
        const idx = state.subscriptions.findIndex((s) => s.id === updated.id);
        if (idx >= 0) state.subscriptions[idx] = updated;
      })
      .addCase(linkSubscriptionContract.fulfilled, (state, action) => {
        const updated = action.payload?.sub;
        if (!updated) return;
        const idx = state.subscriptions.findIndex((s) => s.id === updated.id);
        if (idx >= 0) state.subscriptions[idx] = updated;
      })
      .addCase(fetchBankAccounts.fulfilled, (state, action) => {
        state.bankAccounts = action.payload?.accounts || [];
      })
      .addCase(fetchBankTransactions.fulfilled, (state, action) => {
        state.bankTransactions = action.payload?.transactions || [];
      })
      .addCase(confirmReconciliationMatch.fulfilled, (state, action) => {
        const updated = action.payload?.transaction;
        if (!updated) return;
        const idx = state.bankTransactions.findIndex((t) => t.id === updated.id);
        if (idx >= 0) state.bankTransactions[idx] = updated;
      })
      .addCase(rejectReconciliationSuggestion.fulfilled, (state, action) => {
        const updated = action.payload?.transaction;
        if (!updated) return;
        const idx = state.bankTransactions.findIndex((t) => t.id === updated.id);
        if (idx >= 0) state.bankTransactions[idx] = updated;
      })
      .addCase(markReconciliationReviewRequired.fulfilled, (state, action) => {
        const updated = action.payload?.transaction;
        if (!updated) return;
        const idx = state.bankTransactions.findIndex((t) => t.id === updated.id);
        if (idx >= 0) state.bankTransactions[idx] = updated;
      })
      .addCase(fetchDocumentsStorageOverviewMetrics.fulfilled, (state, action) => {
        state.documentsStorageOverviewMetrics = action.payload?.metrics || null;
      })
      .addCase(fetchExternalFolders.fulfilled, (state, action) => {
        state.externalFolders = action.payload?.folders || [];
      })
      .addCase(fetchExternalFiles.fulfilled, (state, action) => {
        state.externalFiles = action.payload?.files || [];
      })
      .addCase(unlinkExternalFile.fulfilled, (state, action) => {
        const fileId = action.payload?.fileId;
        if (fileId) state.externalFiles = state.externalFiles.filter((f) => f.id !== fileId);
      })
      .addCase(fetchFileAssociations.fulfilled, (state, action) => {
        state.currentFileAssociations = action.payload?.associations || [];
      })
      .addCase(associateFilePreview.fulfilled, (state, action) => {
        const association = action.payload?.association;
        if (association) {
          state.currentFileAssociations.push(association);
          state.lastAssociationUndo = { associationId: association.id };
        }
      })
      .addCase(undoLastAssociation.fulfilled, (state) => {
        state.lastAssociationUndo = null;
      })
      .addCase(fetchFolderMappings.fulfilled, (state, action) => {
        state.folderMappings = action.payload?.mappings || [];
      })
      .addCase(fetchDocumentSyncConflicts.fulfilled, (state, action) => {
        state.documentSyncConflicts = action.payload?.conflicts || [];
      })
      .addCase(resolveDocumentSyncConflict.fulfilled, (state, action) => {
        const updated = action.payload?.conflict;
        if (!updated) return;
        const idx = state.documentSyncConflicts.findIndex((c) => c.id === updated.id);
        if (idx >= 0) state.documentSyncConflicts[idx] = updated;
      })
      .addCase(fetchAccessReviewFindings.fulfilled, (state, action) => {
        state.accessReviewFindings = action.payload?.findings || [];
      })
      .addCase(fetchRetentionPolicies.fulfilled, (state, action) => {
        state.retentionPolicies = action.payload?.policies || [];
      })
      .addCase(fetchLegalHolds.fulfilled, (state, action) => {
        state.legalHolds = action.payload?.holds || [];
      })
      .addCase(removeLegalHold.fulfilled, (state, action) => {
        const updated = action.payload?.hold;
        if (!updated) return;
        const idx = state.legalHolds.findIndex((h) => h.id === updated.id);
        if (idx >= 0) state.legalHolds[idx] = updated;
      })
      .addCase(fetchSignatureTemplates.fulfilled, (state, action) => {
        state.signatureTemplates = action.payload?.templates || [];
      })
      .addCase(fetchSignatureEnvelopes.fulfilled, (state, action) => {
        state.signatureEnvelopes = action.payload?.envelopes || [];
      })
      .addCase(createSignatureWorkflowPreview.fulfilled, (state, action) => {
        const envelope = action.payload?.envelope;
        if (envelope) state.signatureEnvelopes.push(envelope);
      })
      .addCase(markSignatureWorkflowReady.fulfilled, (state, action) => {
        const updated = action.payload?.envelope;
        if (!updated) return;
        const idx = state.signatureEnvelopes.findIndex((e) => e.id === updated.id);
        if (idx >= 0) state.signatureEnvelopes[idx] = updated;
      })
      .addCase(sendSignatureWorkflowPreview.fulfilled, (state, action) => {
        const updated = action.payload?.envelope;
        if (!updated) return;
        const idx = state.signatureEnvelopes.findIndex((e) => e.id === updated.id);
        if (idx >= 0) state.signatureEnvelopes[idx] = updated;
      })
      .addCase(remindSignatureWorkflowPreview.fulfilled, (state, action) => {
        const updated = action.payload?.envelope;
        if (!updated) return;
        const idx = state.signatureEnvelopes.findIndex((e) => e.id === updated.id);
        if (idx >= 0) state.signatureEnvelopes[idx] = updated;
      })
      .addCase(voidSignatureWorkflowPreview.fulfilled, (state, action) => {
        const updated = action.payload?.envelope;
        if (!updated) return;
        const idx = state.signatureEnvelopes.findIndex((e) => e.id === updated.id);
        if (idx >= 0) state.signatureEnvelopes[idx] = updated;
      })
      .addCase(fetchAiProviderOverviewMetrics.fulfilled, (state, action) => {
        state.aiProviderOverviewMetrics = action.payload?.metrics || null;
      })
      .addCase(fetchAiProviderConnections.fulfilled, (state, action) => {
        state.aiProviderConnections = action.payload?.connections || [];
      })
      .addCase(createAiProviderConnectionPreview.fulfilled, (state, action) => {
        const connection = action.payload?.connection;
        if (connection) state.aiProviderConnections.push(connection);
      })
      .addCase(pauseAiProviderConnectionPreview.fulfilled, (state, action) => {
        const updated = action.payload?.connection;
        if (!updated) return;
        const idx = state.aiProviderConnections.findIndex((c) => c.id === updated.id);
        if (idx >= 0) state.aiProviderConnections[idx] = updated;
      })
      .addCase(fetchAiModelAliases.fulfilled, (state, action) => {
        state.aiModelAliases = action.payload?.models || [];
      })
      .addCase(fetchAiUseCases.fulfilled, (state, action) => {
        state.aiUseCases = action.payload?.useCases || [];
      })
      .addCase(fetchAiRoutingPolicies.fulfilled, (state, action) => {
        state.aiRoutingPolicies = action.payload?.policies || [];
      })
      .addCase(updateAiRoutingPolicyPreview.fulfilled, (state, action) => {
        const updated = action.payload?.policy;
        if (!updated) return;
        const idx = state.aiRoutingPolicies.findIndex((p) => p.id === updated.id);
        if (idx >= 0) state.aiRoutingPolicies[idx] = updated;
      })
      .addCase(fetchAiPolicies.fulfilled, (state, action) => {
        state.aiPolicies = action.payload?.policies || [];
      })
      .addCase(updateAiPolicyPreview.fulfilled, (state, action) => {
        const updated = action.payload?.policy;
        if (!updated) return;
        const idx = state.aiPolicies.findIndex((p) => p.id === updated.id);
        if (idx >= 0) state.aiPolicies[idx] = updated;
      })
      .addCase(fetchAiRedactionRules.fulfilled, (state, action) => {
        state.aiRedactionRules = action.payload?.rules || [];
      })
      .addCase(fetchAiContextAssemblyPreview.fulfilled, (state, action) => {
        state.currentAiContextAssemblyPreview = action.payload?.preview || null;
      })
      .addCase(fetchAiUsageEstimates.fulfilled, (state, action) => {
        state.aiUsageEstimates = action.payload?.estimates || [];
      })
      .addCase(fetchAiBudgetPolicies.fulfilled, (state, action) => {
        state.aiBudgetPolicies = action.payload?.budgets || [];
      })
      .addCase(updateAiBudgetPolicyPreview.fulfilled, (state, action) => {
        const updated = action.payload?.budget;
        if (!updated) return;
        const idx = state.aiBudgetPolicies.findIndex((b) => b.id === updated.id);
        if (idx >= 0) state.aiBudgetPolicies[idx] = updated;
      })
      .addCase(fetchAiEvaluationScenarios.fulfilled, (state, action) => {
        state.aiEvaluationScenarios = action.payload?.scenarios || [];
      })
      .addCase(runAiEvaluationScenarioPreview.fulfilled, (state, action) => {
        const updated = action.payload?.scenario;
        if (!updated) return;
        const idx = state.aiEvaluationScenarios.findIndex((s) => s.id === updated.id);
        if (idx >= 0) state.aiEvaluationScenarios[idx] = updated;
      })
      .addCase(fetchAiAuditEvents.fulfilled, (state, action) => {
        state.aiAuditEvents = action.payload?.events || [];
      });

    [pauseConnection, resumeConnection, runPreviewSync, retryFailedSync, updateConnectionConfig, testPreviewConnection, confirmSyncPreview, saveSyncConfiguration, cancelSyncRun].forEach((thunk) =>
      builder.addCase(thunk.fulfilled, applyConnection)
    );
  },
});

export const { setWizardDraft, clearWizardDraft } = integrationsSlice.actions;
export function selectIntegrations(state) {
  return state.integrations;
}
export default integrationsSlice.reducer;
