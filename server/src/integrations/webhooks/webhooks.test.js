import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

const db = {
  integrationWebhookSubscription: { findUnique: vi.fn() },
  integrationConnection: { findUnique: vi.fn() },
  integrationCredential: { findUnique: vi.fn() },
  integrationWebhookEvent: { create: vi.fn(async ({ data }) => ({ id: "ev1", ...data })) },
  integrationTask: { findUnique: vi.fn(async () => null), create: vi.fn(async ({ data }) => ({ id: "t1", ...data })) },
  integrationProvider: { findUnique: vi.fn() },
  integrationPolicy: { findUnique: vi.fn(async () => null) },
  integrationLog: { create: vi.fn() },
  integrationOutboundDelivery: { findUnique: vi.fn(), update: vi.fn() },
  integrationOutboundEndpoint: { findUnique: vi.fn() },
  auditEvent: { create: vi.fn() },
};
vi.mock("../../lib/prisma.js", () => ({ default: db }));
process.env.INTEGRATIONS_MODE = "simulator";

const ssrf = await import("../outbound-webhooks/ssrf.js");
const { verifySignature } = await import("./verifiers.js");
const hooks = await import("./webhookService.js");
const outbound = await import("../outbound-webhooks/outboundService.js");
const { encryptSecret, aadFor } = await import("../credentials/vault.js");
const { signSimulatorWebhook, SIM_WEBHOOK_SECRET } = await import("../simulators/simulatorCore.js");

beforeEach(() => { for (const m of Object.values(db)) for (const fn of Object.values(m)) fn.mockClear?.(); });
const hmac = (algo, key, data, enc) => crypto.createHmac(algo, key).update(data).digest(enc);
const now = Date.now();

describe("SSRF protection", () => {
  it("blocks loopback, private, link-local, CGNAT, reserved and IPv6 local ranges", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a00:1"]) expect(ssrf.isBlockedAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"]) expect(ssrf.isBlockedAddress(ip), ip).toBe(false);
  });

  it("requires HTTPS, no credentials, standard ports, no local host names", () => {
    expect(() => ssrf.validateDestinationUrl("http://example.com/hook", { allowLocal: false })).toThrow(/HTTPS/);
    expect(() => ssrf.validateDestinationUrl("https://user:pw@example.com/", { allowLocal: false })).toThrow(/credentials/);
    expect(() => ssrf.validateDestinationUrl("https://example.com:22/", { allowLocal: false })).toThrow(/port/);
    expect(() => ssrf.validateDestinationUrl("https://printer.local/", { allowLocal: false })).toThrow(/host/);
    expect(() => ssrf.validateDestinationUrl("https://[::1]/", { allowLocal: false })).toThrow(/private/);
    expect(ssrf.validateDestinationUrl("https://hooks.example.com/x", { allowLocal: false }).hostname).toBe("hooks.example.com");
  });

  it("DNS rebinding: any private answer refuses the host; the request is pinned to the checked address", async () => {
    await expect(ssrf.resolvePublic("evil.example", { allowLocal: false, resolver: async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }] })).rejects.toThrow(/private/);
    const send = vi.fn(async () => ({ status: 200 }));
    await ssrf.safeDeliver("https://ok.example/hook", { allowLocal: false, resolver: async () => [{ address: "93.184.216.34", family: 4 }], send });
    expect(send.mock.calls[0][1]).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("redirects are re-validated: a redirect to an internal address is refused", async () => {
    const send = vi.fn().mockResolvedValueOnce({ status: 302, location: "https://internal.example/" }).mockResolvedValue({ status: 200 });
    const resolver = async (host) => [{ address: host === "internal.example" ? "169.254.169.254" : "93.184.216.34", family: 4 }];
    await expect(ssrf.safeDeliver("https://ok.example/hook", { allowLocal: false, resolver, send })).rejects.toThrow(/private/);
    const loop = vi.fn(async () => ({ status: 301, location: "https://ok.example/again" }));
    await expect(ssrf.safeDeliver("https://ok.example/hook", { allowLocal: false, resolver, send: loop })).rejects.toThrow(/Too many redirects/);
  });
});

describe("signature schemes", () => {
  const raw = '{"id":"evt_1","type":"x"}';
  it("GitHub, Slack, Stripe, generic hex/base64, Asana", () => {
    expect(verifySignature("github-sha256", { raw, secret: "s", headers: { "x-hub-signature-256": `sha256=${hmac("sha256", "s", raw, "hex")}` } }).valid).toBe(true);
    expect(verifySignature("github-sha256", { raw, secret: "s", headers: { "x-hub-signature-256": "sha256=00" } }).valid).toBe(false);
    const ts = Math.floor(now / 1000);
    expect(verifySignature("slack-v0", { raw, secret: "s", headers: { "x-slack-request-timestamp": String(ts), "x-slack-signature": `v0=${hmac("sha256", "s", `v0:${ts}:${raw}`, "hex")}` } }).valid).toBe(true);
    expect(verifySignature("slack-v0", { raw, secret: "s", headers: { "x-slack-request-timestamp": String(ts - 600), "x-slack-signature": `v0=${hmac("sha256", "s", `v0:${ts - 600}:${raw}`, "hex")}` } }).reason).toBe("timestamp_out_of_range");
    expect(verifySignature("stripe", { raw, secret: "whsec", headers: { "stripe-signature": `t=${ts},v1=${hmac("sha256", "whsec", `${ts}.${raw}`, "hex")}` } }).valid).toBe(true);
    expect(verifySignature("hmac-sha256-hex", { raw, secret: "k", header: "x-signature", headers: { "x-signature": hmac("sha256", "k", raw, "hex") } }).valid).toBe(true);
    expect(verifySignature("hmac-sha256-base64", { raw, secret: "k", header: "x-xero-signature", headers: { "x-xero-signature": hmac("sha256", "k", raw, "base64") } }).valid).toBe(true);
    expect(verifySignature("asana-hook", { raw, secret: "k", headers: { "x-hook-signature": hmac("sha256", "k", raw, "hex") } }).valid).toBe(true);
  });

  it("Box (primary or secondary key), Trello (body + callback URL), Dropbox Sign, Graph clientState; PayPal is never assumed valid", () => {
    const stamp = new Date(now).toISOString();
    const box = (key) => hmac("sha256", key, Buffer.concat([Buffer.from(raw), Buffer.from(stamp)]), "base64");
    expect(verifySignature("box-v2", { raw, secret: "new", secondarySecret: "old", headers: { "box-delivery-timestamp": stamp, "box-signature-primary": "x", "box-signature-secondary": box("old") } }).valid).toBe(true);
    expect(verifySignature("trello-sha1", { raw, secret: "app", callbackUrl: "https://api/cb", headers: { "x-trello-webhook": hmac("sha1", "app", `${raw}https://api/cb`, "base64") } }).valid).toBe(true);
    const ds = JSON.stringify({ event: { event_time: "1700000000", event_type: "signature_request_signed", event_hash: hmac("sha256", "apikey", "1700000000signature_request_signed", "hex") } });
    expect(verifySignature("dropbox-sign-event-hash", { raw: ds, secret: "apikey", headers: {} }).valid).toBe(true);
    expect(verifySignature("graph-client-state", { raw: JSON.stringify({ value: [{ clientState: "cs" }, { clientState: "bad" }] }), secret: "cs", headers: {} }).valid).toBe(false);
    expect(verifySignature("paypal-verify-api", {}).valid).toBe(false);
    expect(verifySignature("nonsense", {}).valid).toBe(false);
  });
});

describe("inbound webhook handling", () => {
  const secret = SIM_WEBHOOK_SECRET("github");
  const sealed = encryptSecret(secret, aadFor({ organizationId: "o", ownerId: "c", credentialType: "webhook_secret" }));
  const setup = () => {
    db.integrationWebhookSubscription.findUnique.mockResolvedValue({ id: "s", organizationId: "o", connectionId: "c", providerKey: "github", callbackId: "cb", status: "Active", secretCredentialId: "cred", capability: "github.issues" });
    db.integrationConnection.findUnique.mockResolvedValue({ id: "c", organizationId: "o", mode: "Simulator", status: "Connected" });
    db.integrationCredential.findUnique.mockResolvedValue({ ...sealed, id: "cred", organizationId: "o", connectionId: "c", credentialType: "webhook_secret", status: "Active" });
  };
  const body = JSON.stringify({ id: "evt_9", type: "issue.updated" });

  it("unknown subscriptions and oversized bodies are refused before anything else", async () => {
    db.integrationWebhookSubscription.findUnique.mockResolvedValue(null);
    expect((await hooks.receiveWebhook({ providerKey: "github", callbackId: "nope", headers: {}, raw: body })).status).toBe(404);
    expect((await hooks.receiveWebhook({ providerKey: "github", callbackId: "cb", headers: {}, raw: "x".repeat(hooks.MAX_WEBHOOK_BYTES + 1) })).status).toBe(413);
  });

  it("an invalid signature is rejected, logged and audited — nothing stored or queued", async () => {
    setup();
    const r = await hooks.receiveWebhook({ providerKey: "github", callbackId: "cb", headers: { "x-simulator-timestamp": String(Math.floor(now / 1000)), "x-simulator-signature": "bad" }, raw: body });
    expect(r.status).toBe(401);
    expect(db.integrationWebhookEvent.create).not.toHaveBeenCalled();
    expect(db.auditEvent.create.mock.calls[0][0].data).toMatchObject({ action: "integrations.webhook.rejected", result: "Denied" });
  });

  it("a valid event is stored and queued; a duplicate delivery is acknowledged but not reprocessed", async () => {
    setup();
    const headers = signSimulatorWebhook(secret, body);
    const r = await hooks.receiveWebhook({ providerKey: "github", callbackId: "cb", headers, raw: body });
    expect(r).toMatchObject({ status: 200, eventId: "ev1" });
    expect(db.integrationWebhookEvent.create.mock.calls[0][0].data).toMatchObject({ providerEventId: "evt_9", signatureValid: true });
    expect(db.integrationTask.create.mock.calls[0][0].data).toMatchObject({ kind: "webhook_event", refId: "ev1" });
    db.integrationWebhookEvent.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    const dup = await hooks.receiveWebhook({ providerKey: "github", callbackId: "cb", headers, raw: body });
    expect(dup.body).toMatchObject({ duplicate: true });
    expect(db.integrationTask.create).toHaveBeenCalledTimes(1);
  });
});

describe("outbound deliveries", () => {
  it("payloads are signed with timestamp and delivery id", () => {
    expect(outbound.signPayload("whsec_x", 1000, "{}")).toBe(hmac("sha256", "whsec_x", "1000.{}", "hex"));
    expect(outbound.OUTBOUND_EVENTS["finance.invoice.posted"]).toBe("invoice.posted");
  });

  it("4xx is permanent, 5xx retries, a blocked destination is never retried; the signature header is sent", async () => {
    const endpoint = { id: "e", active: true, url: "https://hooks.example/x", timeoutMs: 1000, secretCredentialId: "sc" };
    const sealed = encryptSecret("whsec_k", aadFor({ organizationId: "o", ownerId: null, credentialType: "signing_secret" }));
    db.integrationCredential.findUnique.mockResolvedValue({ ...sealed, organizationId: "o", credentialType: "signing_secret", status: "Active" });
    db.integrationOutboundEndpoint.findUnique.mockResolvedValue(endpoint);
    db.integrationOutboundDelivery.findUnique.mockResolvedValue({ id: "d", endpointId: "e", attempt: 0, result: "Pending", deliveryId: "dlv_1", eventType: "deal.won", payload: { type: "deal.won", data: {} } });
    const resolver = async () => [{ address: "93.184.216.34", family: 4 }];
    const send = vi.fn(async () => ({ status: 400 }));
    expect(await outbound.deliver("d", { send, resolver })).toBe(false);
    expect(db.integrationOutboundDelivery.update.mock.calls.at(-1)[0].data).toMatchObject({ result: "Failed", responseStatus: 400 });
    const { headers, body } = send.mock.calls[0][2];
    const [, ts, sig] = headers["X-Caspira-Signature"].match(/^t=(\d+),v1=([0-9a-f]+)$/);
    expect(sig).toBe(hmac("sha256", "whsec_k", `${ts}.${body}`, "hex"));
    expect(headers["X-Caspira-Delivery-Id"]).toBe("dlv_1");
    await expect(outbound.deliver("d", { send: vi.fn(async () => ({ status: 503 })), resolver })).rejects.toMatchObject({ retryable: true });
    expect(db.integrationOutboundDelivery.update.mock.calls.at(-1)[0].data).toMatchObject({ result: "Pending", responseStatus: 503 });
    db.integrationOutboundEndpoint.findUnique.mockResolvedValue({ ...endpoint, url: "https://127.0.0.1/x" });
    expect(await outbound.deliver("d", { send: vi.fn(async () => ({ status: 200 })), resolver })).toBeNull();
    expect(db.integrationOutboundDelivery.update.mock.calls.at(-1)[0].data).toMatchObject({ result: "Failed", safeError: expect.stringMatching(/Blocked/) });
  });
});