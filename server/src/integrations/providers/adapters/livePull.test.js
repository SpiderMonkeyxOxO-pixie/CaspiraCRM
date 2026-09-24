import { describe, it, expect, afterEach } from "vitest";
import { setTransport, resetTransport } from "../../common/http.js";
import { LIVE_ADAPTERS } from "./liveAdapters.js";
import { normalize } from "../../synchronization/transformers.js";

const calls = [];
function stub(routes) {
  setTransport(async (url, init) => {
    calls.push({ url, headers: init.headers });
    const r = routes(new URL(url), init) || { status: 404, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status || 200, headers: { "content-type": "application/json", ...(r.headers || {}) } });
  });
}
afterEach(() => { resetTransport(); calls.length = 0; });
const pull = (key, args) => LIVE_ADAPTERS[key].pullChanges({ accessToken: "tok", limit: 2, filters: {}, ...args });

describe("live pullChanges", () => {
  it("is advertised only for the priority providers", () => {
    for (const k of ["google_workspace", "microsoft_365", "github", "stripe", "xero"]) expect(LIVE_ADAPTERS[k].supports("pullChanges")).toBe(true);
    expect(LIVE_ADAPTERS.jira.supports("pullChanges")).toBe(false);
  });

  it("Google: pages with pageToken, returns nextSyncToken only on the last page; 410 → expired", async () => {
    stub((u) => (u.searchParams.get("pageToken")
      ? { body: { items: [{ id: "e2", status: "cancelled" }], nextSyncToken: "sync-2" } }
      : { body: { items: [{ id: "e1", summary: "Kickoff", start: { dateTime: "2026-09-01T10:00:00+02:00", timeZone: "Europe/Berlin" }, end: { dateTime: "2026-09-01T11:00:00+02:00" } }], nextPageToken: "p2" } }));
    const p1 = await pull("google_workspace", { entityType: "calendar_event" });
    expect(p1.deltaToken).toBeNull();
    expect(calls[0].url).toContain("/calendars/primary/events");
    const p2 = await pull("google_workspace", { entityType: "calendar_event", cursor: p1.nextCursor });
    expect(p2).toMatchObject({ nextCursor: null, deltaToken: "sync-2" });
    expect(normalize("google_workspace", "Live", "calendar_event", p2.items[0]).deleted).toBe(true);
    expect(normalize("google_workspace", "Live", "calendar_event", p1.items[0]).fields.timeZone).toBe("Europe/Berlin");

    stub(() => ({ status: 410, body: { error: { code: 410, message: "Sync token is no longer valid" } } }));
    await expect(pull("google_workspace", { entityType: "calendar_event", deltaToken: "old" })).rejects.toMatchObject({ status: 410 });
  });

  it("Microsoft: follows nextLink, stores deltaLink, refuses a link to another host", async () => {
    stub((u) => (u.searchParams.get("$skiptoken")
      ? { body: { value: [{ id: "m2", "@removed": { reason: "deleted" } }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=D" } }
      : { body: { value: [{ id: "m1", subject: "Review", start: { dateTime: "2026-09-02T09:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-09-02T10:00:00.0000000", timeZone: "UTC" } }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView/delta?$skiptoken=S" } }));
    const p1 = await pull("microsoft_365", { entityType: "calendar_event" });
    expect(calls[0].url).toMatch(/startDateTime=.*endDateTime=/);
    expect(calls[0].headers.Prefer).toBe("odata.maxpagesize=2");
    const p2 = await pull("microsoft_365", { entityType: "calendar_event", cursor: p1.nextCursor });
    expect(p2.deltaToken).toContain("$deltatoken=D");
    expect(normalize("microsoft_365", "Live", "calendar_event", p1.items[0]).fields.startAt).toBe("2026-09-02T09:00:00.000Z");
    await expect(pull("microsoft_365", { entityType: "calendar_event", deltaToken: "https://evil.example/steal" })).rejects.toThrow(/another host/);
  });

  it("GitHub: needs a repository, pages by Link header, checkpoint = latest updated_at", async () => {
    await expect(pull("github", { entityType: "issue" })).rejects.toThrow(/repository/);
    stub((u) => (u.searchParams.get("page") === "1"
      ? { body: [{ id: 1, title: "Bug", state: "open", updated_at: "2026-09-01T00:00:00Z" }], headers: { link: '<https://api.github.com/x?page=2>; rel="next"' } }
      : { body: [{ id: 2, title: "PR", pull_request: {}, updated_at: "2026-09-03T00:00:00Z" }] }));
    const p1 = await pull("github", { entityType: "issue", filters: { repository: "acme/app" }, deltaToken: "2026-08-01T00:00:00Z" });
    expect(calls[0].url).toContain("since=2026-08-01");
    const p2 = await pull("github", { entityType: "issue", filters: { repository: "acme/app" }, cursor: p1.nextCursor });
    expect(p2.deltaToken).toBe("2026-09-03T00:00:00Z");
    expect(normalize("github", "Live", "issue", p2.items[0]).skip).toBe(true);
  });

  it("Stripe: starting_after paging, created[gt] checkpoint, minor units converted", async () => {
    stub((u) => (u.searchParams.get("starting_after")
      ? { body: { data: [{ id: "txn_1", created: 1_700_000_000, amount: -500, currency: "usd", type: "payout" }], has_more: false } }
      : { body: { data: [{ id: "txn_2", created: 1_700_000_100, amount: 12345, currency: "usd", type: "charge" }], has_more: true } }));
    const p1 = await pull("stripe", { entityType: "financial_transaction", deltaToken: "1699999999" });
    expect(calls[0].url).toContain("created%5Bgt%5D=1699999999");
    const p2 = await pull("stripe", { entityType: "financial_transaction", cursor: p1.nextCursor });
    expect(p2.deltaToken).toBe("1700000100");
    expect(normalize("stripe", "Live", "financial_transaction", p1.items[0]).fields).toMatchObject({ amount: "123.45", direction: "Credit", currency: "USD" });
  });

  it("Xero: tenant header required, If-Modified-Since from checkpoint", async () => {
    await expect(pull("xero", { entityType: "financial_transaction" })).rejects.toThrow(/organisation/);
    stub(() => ({ body: { BankTransactions: [{ BankTransactionID: "b1", Type: "SPEND", Total: 42, CurrencyCode: "NZD", Status: "AUTHORISED", DateString: "2026-09-01T00:00:00", UpdatedDateUTC: "/Date(1788220800000+0000)/" }] } }));
    const p = await pull("xero", { entityType: "financial_transaction", tenantId: "t-1", deltaToken: "2026-08-01T00:00:00.000Z" });
    expect(calls[0].headers["Xero-tenant-id"]).toBe("t-1");
    expect(calls[0].headers["If-Modified-Since"]).toBe("2026-08-01T00:00:00");
    expect(p).toMatchObject({ nextCursor: null, deltaToken: "2026-09-01T00:00:00.000Z" });
    expect(normalize("xero", "Live", "financial_transaction", p.items[0]).fields).toMatchObject({ direction: "Debit", amount: "42.00" });
  });

  it("refuses the wrong entity type", async () => {
    await expect(pull("stripe", { entityType: "issue" })).rejects.toThrow(/can't read/);
  });
});
