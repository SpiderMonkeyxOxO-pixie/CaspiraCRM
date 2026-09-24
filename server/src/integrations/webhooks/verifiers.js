// Backend Phase 8 — inbound webhook signature schemes (from each provider's
// docs; see the catalog's protocol.webhook notes). Each takes the RAW body
// bytes and headers and returns { valid, reason, timestamp }. Comparisons
// are constant-time. A scheme we can't verify locally says so — it's never
// treated as valid.
import crypto from "node:crypto";
import { safeEqual } from "../credentials/vault.js";

const hmac = (algo, key, data, enc) => crypto.createHmac(algo, key).update(data).digest(enc);
const h = (headers, name) => headers[name.toLowerCase()] ?? null;
const within = (seconds, toleranceSec, now) => Math.abs(now / 1000 - seconds) <= toleranceSec;
export const TOLERANCE_SECONDS = 300;

export const SCHEMES = {
  // Provider simulator: t.body HMAC, 5-minute tolerance.
  simulator({ headers, raw, secret, now }) {
    const ts = Number(h(headers, "x-simulator-timestamp"));
    if (!ts || !within(ts, TOLERANCE_SECONDS, now)) return { valid: false, reason: "timestamp_out_of_range" };
    return { valid: safeEqual(hmac("sha256", secret, `${ts}.${raw}`, "hex"), h(headers, "x-simulator-signature")), reason: "signature", timestamp: new Date(ts * 1000) };
  },
  "slack-v0"({ headers, raw, secret, now }) {
    const ts = Number(h(headers, "x-slack-request-timestamp"));
    if (!ts || !within(ts, TOLERANCE_SECONDS, now)) return { valid: false, reason: "timestamp_out_of_range" };
    return { valid: safeEqual(`v0=${hmac("sha256", secret, `v0:${ts}:${raw}`, "hex")}`, h(headers, "x-slack-signature")), reason: "signature", timestamp: new Date(ts * 1000) };
  },
  "github-sha256"({ headers, raw, secret }) {
    return { valid: safeEqual(`sha256=${hmac("sha256", secret, raw, "hex")}`, h(headers, "x-hub-signature-256")), reason: "signature" };
  },
  stripe({ headers, raw, secret, now }) {
    const parts = Object.fromEntries(String(h(headers, "stripe-signature") || "").split(",").map((p) => p.split("=")).filter((p) => p.length === 2));
    const ts = Number(parts.t);
    if (!ts || !within(ts, TOLERANCE_SECONDS, now)) return { valid: false, reason: "timestamp_out_of_range" };
    return { valid: safeEqual(hmac("sha256", secret, `${ts}.${raw}`, "hex"), parts.v1), reason: "signature", timestamp: new Date(ts * 1000) };
  },
  "hmac-sha256-hex"({ headers, raw, secret, header }) {
    return { valid: safeEqual(hmac("sha256", secret, raw, "hex"), h(headers, header)), reason: "signature" };
  },
  "hmac-sha256-base64"({ headers, raw, secret, header }) {
    return { valid: safeEqual(hmac("sha256", secret, raw, "base64"), h(headers, header)), reason: "signature" };
  },
  "asana-hook"({ headers, raw, secret }) {
    return { valid: safeEqual(hmac("sha256", secret, raw, "hex"), h(headers, "x-hook-signature")), reason: "signature" };
  },
  // Box: primary OR secondary key (rotation); body + delivery timestamp; 10 minutes.
  "box-v2"({ headers, raw, secret, secondarySecret, now }) {
    const stamp = h(headers, "box-delivery-timestamp");
    const at = Date.parse(stamp || "");
    if (!at || Math.abs(now - at) > 10 * 60_000) return { valid: false, reason: "timestamp_out_of_range" };
    const digest = (key) => hmac("sha256", key, Buffer.concat([Buffer.from(raw), Buffer.from(stamp)]), "base64");
    const valid = safeEqual(digest(secret), h(headers, "box-signature-primary")) || (secondarySecret && safeEqual(digest(secondarySecret), h(headers, "box-signature-secondary")));
    return { valid: !!valid, reason: "signature", timestamp: new Date(at) };
  },
  // Trello: base64(HMAC-SHA1(secret, body + callback URL exactly as registered)).
  "trello-sha1"({ headers, raw, secret, callbackUrl }) {
    return { valid: safeEqual(hmac("sha1", secret, `${raw}${callbackUrl}`, "base64"), h(headers, "x-trello-webhook")), reason: "signature" };
  },
  // Google push channels: the token set at watch time must come back.
  "channel-token"({ headers, secret }) {
    return { valid: safeEqual(secret, h(headers, "x-goog-channel-token")), reason: "channel_token" };
  },
  // Microsoft Graph: every notification's clientState must equal ours.
  "graph-client-state"({ raw, secret }) {
    try {
      const values = JSON.parse(raw).value || [];
      return { valid: values.length > 0 && values.every((v) => safeEqual(secret, v.clientState)), reason: "client_state" };
    } catch { return { valid: false, reason: "unparseable" }; }
  },
  "dropbox-sign-event-hash"({ raw, secret }) {
    try {
      const { event } = JSON.parse(raw);
      return { valid: safeEqual(hmac("sha256", secret, `${event.event_time}${event.event_type}`, "hex"), event.event_hash), reason: "event_hash" };
    } catch { return { valid: false, reason: "unparseable" }; }
  },
  // PayPal requires a verification API call to PayPal; not done locally.
  "paypal-verify-api"() {
    return { valid: false, reason: "requires_provider_verification_call" };
  },
};

export function verifySignature(scheme, args) {
  const fn = SCHEMES[scheme];
  if (!fn) return { valid: false, reason: "unsupported_scheme" };
  return fn({ now: Date.now(), ...args });
}

// The provider's own delivery id where there is one; else the payload hash.
export function eventIdentity(providerKey, headers, body, payloadHash) {
  const id = h(headers, "x-github-delivery") || h(headers, "x-simulator-event-id") || h(headers, "box-delivery-id")
    || body?.event_id || body?.id || body?.eventId || body?.event?.event_hash || null;
  const type = h(headers, "x-github-event") || body?.type || body?.event?.type || body?.event?.event_type || body?.eventType || body?.trigger || "event";
  return { providerEventId: String(id || payloadHash).slice(0, 200), eventType: String(type).slice(0, 120) };
}
