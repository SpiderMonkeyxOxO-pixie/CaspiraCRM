// Backend Phase 8 — live change reading (pullChanges) for the priority
// providers. Same contract as the simulator adapter:
//   pullChanges({ accessToken, entityType, cursor, deltaToken, limit, filters, tenantId })
//     → { items, nextCursor, deltaToken, rateLimit }
// `cursor` pages within one run (opaque, ours); `deltaToken` is the stored
// checkpoint and is only returned on the last page. An expired provider
// change token surfaces as HTTP 410 (Google, Microsoft Graph), which the
// sync engine turns into "run a new preview" — never an automatic resync.
// Endpoints, paging and change tokens follow each provider's official docs.
import { providerRequest } from "../../common/http.js";
import { IntegrationError, KINDS } from "../../common/errors.js";

const pack = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const unpack = (c) => { try { return c ? JSON.parse(Buffer.from(c, "base64url").toString("utf8")) : {}; } catch { throw new IntegrationError(KINDS.PERMANENT, "Invalid sync cursor."); } };
const clampLimit = (n, max) => Math.max(1, Math.min(max, Number(n) || 50));
const wrongEntity = (provider, entityType) => new IntegrationError(KINDS.UNSUPPORTED, `${provider} can't read ${entityType} records.`);
// A provider-supplied paging link is followed only if it stays on the provider's API host.
function sameOrigin(link, origin) {
  let u;
  try { u = new URL(link); } catch { throw new IntegrationError(KINDS.PERMANENT, "The provider returned an invalid paging link."); }
  if (u.origin !== origin) throw new IntegrationError(KINDS.PERMANENT, "The provider returned a paging link to another host; it was not followed.");
  return u.toString();
}
const toIsoMax = (a, b) => (!a ? b : !b ? a : new Date(a) > new Date(b) ? a : b);

// Google Calendar — events.list with nextPageToken / nextSyncToken
// (developers.google.com/calendar/api/guides/sync). 410 Gone = token expired.
async function googleCalendar({ accessToken, entityType, cursor, deltaToken, limit, filters }) {
  if (entityType !== "calendar_event") throw wrongEntity("Google", entityType);
  const calendarId = encodeURIComponent(filters?.calendarId || "primary");
  const u = new URL(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`);
  u.searchParams.set("maxResults", String(clampLimit(limit, 250)));
  const c = unpack(cursor);
  const syncToken = c.syncToken || deltaToken;
  if (syncToken) u.searchParams.set("syncToken", syncToken);
  else u.searchParams.set("showDeleted", "true");
  if (c.pageToken) u.searchParams.set("pageToken", c.pageToken);
  const { data, rateLimit } = await providerRequest(u.toString(), { bearer: accessToken });
  return {
    items: data.items || [],
    nextCursor: data.nextPageToken ? pack({ pageToken: data.nextPageToken, syncToken: syncToken || null }) : null,
    deltaToken: data.nextPageToken ? null : data.nextSyncToken || syncToken || null,
    rateLimit,
  };
}

// Microsoft Graph — calendarView delta (learn.microsoft.com/graph/delta-query-events).
// Pages follow @odata.nextLink; the last page carries @odata.deltaLink.
const GRAPH = "https://graph.microsoft.com";
async function microsoftCalendar({ accessToken, entityType, cursor, deltaToken, limit, filters }) {
  if (entityType !== "calendar_event") throw wrongEntity("Microsoft 365", entityType);
  let url;
  const c = unpack(cursor);
  if (c.next) url = sameOrigin(c.next, GRAPH);
  else if (deltaToken) url = sameOrigin(deltaToken, GRAPH);
  else {
    const days = Math.min(365, Math.max(1, Number(filters?.windowDays) || 180));
    const u = new URL(`${GRAPH}/v1.0/me/calendarView/delta`);
    u.searchParams.set("startDateTime", new Date(Date.now() - 30 * 86_400_000).toISOString());
    u.searchParams.set("endDateTime", new Date(Date.now() + days * 86_400_000).toISOString());
    url = u.toString();
  }
  const { data, rateLimit } = await providerRequest(url, { bearer: accessToken, headers: { Prefer: `odata.maxpagesize=${clampLimit(limit, 100)}` } });
  const next = data["@odata.nextLink"];
  return { items: data.value || [], nextCursor: next ? pack({ next }) : null, deltaToken: next ? null : data["@odata.deltaLink"] || deltaToken || null, rateLimit };
}

// GitHub — issues for one repository, oldest update first, `since` = checkpoint
// (docs.github.com/rest/issues/issues#list-repository-issues). Pull requests are
// returned by this endpoint too; the normalizer skips them.
async function githubIssues({ accessToken, entityType, cursor, deltaToken, limit, filters }) {
  if (entityType !== "issue") throw wrongEntity("GitHub", entityType);
  const repo = String(filters?.repository || "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new IntegrationError(KINDS.PERMANENT, "Choose the repository to import from (filters.repository = \"owner/name\").");
  const c = unpack(cursor);
  const since = c.since ?? deltaToken ?? null;
  const page = c.page || 1;
  const u = new URL(`https://api.github.com/repos/${repo}/issues`);
  u.searchParams.set("state", "all");
  u.searchParams.set("sort", "updated");
  u.searchParams.set("direction", "asc");
  u.searchParams.set("per_page", String(clampLimit(limit, 100)));
  u.searchParams.set("page", String(page));
  if (since) u.searchParams.set("since", since);
  const { data, headers, rateLimit } = await providerRequest(u.toString(), { bearer: accessToken, headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
  const items = Array.isArray(data) ? data : [];
  const max = items.reduce((m, i) => toIsoMax(m, i.updated_at), c.max || null);
  const hasNext = /rel="next"/.test(headers?.get?.("link") || "");
  return { items, nextCursor: hasNext ? pack({ page: page + 1, since, max }) : null, deltaToken: hasNext ? null : toIsoMax(max, since) || null, rateLimit };
}

// Stripe — balance transactions, newest first; `created[gt]` = checkpoint
// (docs.stripe.com/api/balance_transactions/list, docs.stripe.com/api/pagination).
async function stripeTransactions({ accessToken, entityType, cursor, deltaToken, limit }) {
  if (entityType !== "financial_transaction") throw wrongEntity("Stripe", entityType);
  const c = unpack(cursor);
  const gt = c.gt ?? (deltaToken ? Number(deltaToken) : null);
  const u = new URL("https://api.stripe.com/v1/balance_transactions");
  u.searchParams.set("limit", String(clampLimit(limit, 100)));
  if (c.after) u.searchParams.set("starting_after", c.after);
  if (gt) u.searchParams.set("created[gt]", String(gt));
  const { data, rateLimit } = await providerRequest(u.toString(), { bearer: accessToken });
  const items = data.data || [];
  const max = items.reduce((m, t) => Math.max(m, t.created || 0), c.max || gt || 0);
  const more = data.has_more && items.length;
  return { items, nextCursor: more ? pack({ after: items[items.length - 1].id, gt, max }) : null, deltaToken: more ? null : max ? String(max) : null, rateLimit };
}

// Xero — BankTransactions for the connected organisation (Xero-tenant-id),
// paged by `page` (100 per page), If-Modified-Since = checkpoint
// (developer.xero.com/documentation/api/accounting/banktransactions).
const xeroDate = (v) => { const m = /\/Date\((\d+)/.exec(String(v || "")); return m ? new Date(Number(m[1])).toISOString() : null; };
async function xeroTransactions({ accessToken, entityType, cursor, deltaToken, tenantId }) {
  if (entityType !== "financial_transaction") throw wrongEntity("Xero", entityType);
  if (!tenantId) throw new IntegrationError(KINDS.NOT_CONFIGURED, "The Xero organisation for this connection is unknown. Reauthorize and choose an organisation.");
  const c = unpack(cursor);
  const since = c.since ?? deltaToken ?? null;
  const page = c.page || 1;
  const u = new URL("https://api.xero.com/api.xro/2.0/BankTransactions");
  u.searchParams.set("page", String(page));
  const headers = { "Xero-tenant-id": tenantId, ...(since && { "If-Modified-Since": since.replace(/\.\d+Z$/, "") }) };
  const { data, rateLimit } = await providerRequest(u.toString(), { bearer: accessToken, headers });
  const items = data?.BankTransactions || [];
  const max = items.reduce((m, t) => toIsoMax(m, xeroDate(t.UpdatedDateUTC)), c.max || null);
  const hasNext = items.length >= 100;
  return { items, nextCursor: hasNext ? pack({ page: page + 1, since, max }) : null, deltaToken: hasNext ? null : toIsoMax(max, since) || null, rateLimit };
}

export const LIVE_PULL = {
  google_workspace: googleCalendar,
  microsoft_365: microsoftCalendar,
  github: githubIssues,
  stripe: stripeTransactions,
  xero: xeroTransactions,
};
