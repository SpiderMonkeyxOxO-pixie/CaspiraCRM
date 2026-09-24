// Backend Phase 8 — explicit, confirmed actions against live providers.
// Called only after a person previewed and confirmed the exact payload
// (see actions/actionService.js). Drafts are created as drafts and never
// sent; notifications go to the one channel the person chose; message reads
// fetch headers only — never a body.
//
//   performAction({ accessToken, kind, payload, idempotencyKey }) → { externalId }
//     notify: { channel, teamId?, text }     draft: { to: [], subject, body }
//   readMessage({ accessToken, messageId }) → { id, threadId, subject, from, to, date, category }
import { providerRequest } from "../../common/http.js";
import { IntegrationError, KINDS } from "../../common/errors.js";

const GRAPH = "https://graph.microsoft.com/v1.0";
const oneLine = (v) => String(v ?? "").replace(/[\r\n]+/g, " ").trim();
const unsupportedKind = (provider, kind) => new IntegrationError(KINDS.UNSUPPORTED, `${provider} doesn't support the ${kind} action.`);

// RFC 5322 message for a Gmail draft. Header values are single-line (no
// header injection); the subject is RFC 2047 encoded.
export function rfc822({ to, subject, body }) {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(oneLine(subject)).toString("base64")}?=`;
  const lines = [
    `To: ${to.map(oneLine).join(", ")}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(String(body ?? "")).toString("base64"),
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

const header = (headers, name) => (headers || []).find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || null;

export const LIVE_ACTIONS = {
  // chat.postMessage (api.slack.com/methods/chat.postMessage).
  slack: {
    async performAction({ accessToken, kind, payload }) {
      if (kind !== "notify") throw unsupportedKind("Slack", kind);
      const { data } = await providerRequest("https://slack.com/api/chat.postMessage", { method: "POST", bearer: accessToken, json: { channel: payload.channel, text: payload.text, unfurl_links: false, unfurl_media: false } });
      return { externalId: `${data.channel}:${data.ts}` };
    },
  },
  google_workspace: {
    // users.drafts.create (developers.google.com/gmail/api/reference/rest/v1/users.drafts/create).
    async performAction({ accessToken, kind, payload }) {
      if (kind !== "draft") throw unsupportedKind("Google Workspace", kind);
      const { data } = await providerRequest("https://gmail.googleapis.com/gmail/v1/users/me/drafts", { method: "POST", bearer: accessToken, json: { message: { raw: rfc822(payload) } } });
      return { externalId: data.id };
    },
    // users.messages.get with format=metadata (works with the gmail.metadata scope).
    async readMessage({ accessToken, messageId }) {
      const u = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`);
      u.searchParams.set("format", "metadata");
      for (const h of ["Subject", "From", "To", "Date"]) u.searchParams.append("metadataHeaders", h);
      const { data } = await providerRequest(u.toString(), { bearer: accessToken });
      const hs = data.payload?.headers;
      return { id: data.id, threadId: data.threadId, subject: header(hs, "Subject"), from: header(hs, "From"), to: (header(hs, "To") || "").split(",").map((s) => s.trim()).filter(Boolean), date: header(hs, "Date"), category: null };
    },
  },
  microsoft_365: {
    async performAction({ accessToken, kind, payload }) {
      // POST /teams/{id}/channels/{id}/messages (learn.microsoft.com/graph/api/chatmessage-post).
      if (kind === "notify") {
        if (!payload.teamId || !payload.channel) throw new IntegrationError(KINDS.PERMANENT, "Choose the team and channel.");
        const { data } = await providerRequest(`${GRAPH}/teams/${encodeURIComponent(payload.teamId)}/channels/${encodeURIComponent(payload.channel)}/messages`, { method: "POST", bearer: accessToken, json: { body: { contentType: "text", content: payload.text } } });
        return { externalId: data.id };
      }
      // POST /me/messages creates a draft (learn.microsoft.com/graph/api/user-post-messages).
      if (kind === "draft") {
        const { data } = await providerRequest(`${GRAPH}/me/messages`, { method: "POST", bearer: accessToken, json: { subject: oneLine(payload.subject), body: { contentType: "Text", content: String(payload.body ?? "") }, toRecipients: payload.to.map((address) => ({ emailAddress: { address: oneLine(address) } })) } });
        return { externalId: data.id };
      }
      throw unsupportedKind("Microsoft 365", kind);
    },
    async readMessage({ accessToken, messageId }) {
      const u = new URL(`${GRAPH}/me/messages/${encodeURIComponent(messageId)}`);
      u.searchParams.set("$select", "subject,from,toRecipients,receivedDateTime,conversationId");
      const { data } = await providerRequest(u.toString(), { bearer: accessToken });
      return { id: data.id, threadId: data.conversationId, subject: data.subject || null, from: data.from?.emailAddress?.address || null, to: (data.toRecipients || []).map((r) => r.emailAddress?.address).filter(Boolean), date: data.receivedDateTime || null, category: null };
    },
  },
};
