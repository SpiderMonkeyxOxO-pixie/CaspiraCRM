import { describe, it, expect, afterEach } from "vitest";
import { setTransport, resetTransport } from "../common/http.js";
import { LIVE_ADAPTERS } from "../providers/adapters/liveAdapters.js";
import { rfc822 } from "../providers/adapters/liveActions.js";
import { createSimulator } from "../simulators/simulatorCore.js";
import { neutralizeMentions, ACTIONS } from "./actionService.js";

const calls = [];
function stub(body, status = 200) {
  setTransport(async (url, init) => {
    calls.push({ url, init, json: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
}
afterEach(() => { resetTransport(); calls.length = 0; });

describe("action safety", () => {
  it("removes broadcast mentions", () => {
    const { text, removed } = neutralizeMentions("Heads up <!channel> and @here — deal won by @everyone's favourite <@U123>");
    expect(removed).toBe(3);
    expect(text).not.toMatch(/<!channel>|@here|@everyone/);
    expect(text).toContain("<@U123>");
  });

  it("Gmail draft MIME has no header injection and an encoded subject", () => {
    const raw = Buffer.from(rfc822({ to: ["a@example.com\r\nBcc: evil@example.com"], subject: "Hi\r\nBcc: x@example.com", body: "Body" }), "base64url").toString();
    const headers = raw.split("\r\n\r\n")[0].split("\r\n");
    expect(headers.filter((h) => /^bcc:/i.test(h))).toHaveLength(0);
    expect(headers.find((h) => h.startsWith("Subject:"))).toMatch(/^Subject: =\?UTF-8\?B\?/);
  });

  it("lists only the supported actions", () => {
    expect(Object.keys(ACTIONS).sort()).toEqual(["gmail.draft", "gmail.link_message", "outlook.draft", "outlook.link_message", "slack.notify", "teams.notify"]);
  });
});

describe("live action adapters", () => {
  it("Slack posts to the chosen channel without unfurls", async () => {
    stub({ ok: true, channel: "C1", ts: "123.45" });
    const r = await LIVE_ADAPTERS.slack.performAction({ accessToken: "t", kind: "notify", payload: { channel: "C1", text: "Won" } });
    expect(r.externalId).toBe("C1:123.45");
    expect(calls[0].url).toBe("https://slack.com/api/chat.postMessage");
    expect(calls[0].json).toMatchObject({ channel: "C1", text: "Won", unfurl_links: false });
  });

  it("Slack refuses a draft", async () => {
    await expect(LIVE_ADAPTERS.slack.performAction({ accessToken: "t", kind: "draft", payload: {} })).rejects.toThrow(/doesn't support/);
  });

  it("Gmail creates a draft (drafts endpoint, never send)", async () => {
    stub({ id: "r-1" });
    await LIVE_ADAPTERS.google_workspace.performAction({ accessToken: "t", kind: "draft", payload: { to: ["a@example.com"], subject: "S", body: "B" } });
    expect(calls[0].url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    expect(calls[0].url).not.toMatch(/send/);
  });

  it("Gmail reads headers only (format=metadata)", async () => {
    stub({ id: "m1", threadId: "t1", payload: { headers: [{ name: "Subject", value: "Quote" }, { name: "From", value: "c@x.example" }, { name: "To", value: "a@y.example, b@y.example" }] } });
    const m = await LIVE_ADAPTERS.google_workspace.readMessage({ accessToken: "t", messageId: "m1" });
    expect(calls[0].url).toContain("format=metadata");
    expect(m).toMatchObject({ subject: "Quote", from: "c@x.example", to: ["a@y.example", "b@y.example"] });
  });

  it("Outlook draft goes to /me/messages; Teams posts to the channel", async () => {
    stub({ id: "d1" });
    await LIVE_ADAPTERS.microsoft_365.performAction({ accessToken: "t", kind: "draft", payload: { to: ["a@example.com"], subject: "S", body: "B" } });
    expect(calls[0].url).toBe("https://graph.microsoft.com/v1.0/me/messages");
    expect(calls[0].json.toRecipients[0].emailAddress.address).toBe("a@example.com");
    await LIVE_ADAPTERS.microsoft_365.performAction({ accessToken: "t", kind: "notify", payload: { teamId: "T", channel: "19:abc@thread.tacv2", text: "Hi" } });
    expect(calls[1].url).toBe("https://graph.microsoft.com/v1.0/teams/T/channels/19%3Aabc%40thread.tacv2/messages");
  });
});

describe("simulator actions", () => {
  it("records a notify once per idempotency key and rejects unknown channels", () => {
    const sim = createSimulator();
    const { body: tok } = sim.token({ provider: "slack", grant_type: "authorization_code", code: new URL(sim.authorize({ provider: "slack", client_id: "sim-client-slack", redirect_uri: "http://x/cb", state: "s" }).redirect).searchParams.get("code"), redirect_uri: "http://x/cb", client_id: "sim-client-slack", client_secret: "sim-secret-slack" });
    const a = sim.act({ provider: "slack", bearer: tok.access_token, kind: "notify", payload: { channel: "C-general", text: "x" }, idempotencyKey: "k1" });
    const b = sim.act({ provider: "slack", bearer: tok.access_token, kind: "notify", payload: { channel: "C-general", text: "x" }, idempotencyKey: "k1" });
    expect(a.status).toBe(201);
    expect(b.body).toMatchObject({ id: a.body.id, replayed: true });
    expect(sim.control.actions("slack")).toHaveLength(1);
    expect(sim.act({ provider: "slack", bearer: tok.access_token, kind: "notify", payload: { channel: "C-nope" } }).status).toBe(404);
  });
});
