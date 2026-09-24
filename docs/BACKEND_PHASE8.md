# Backend Phase 8 — External Integrations, OAuth Connections, Webhooks and Provider Synchronization

Spec: [docs/specs/BACKEND_PHASE8_SPEC.md](specs/BACKEND_PHASE8_SPEC.md). Code lives in `server/src/integrations/`.

This phase turns the Integration Center from a frontend-only preview into a backend integration gateway that works with any provider. Some limits to know up front:

- **No provider has been verified against its real API in this phase.** All end-to-end verification ran against the **Provider Simulator**, which is always labelled *"Provider Simulator — no external provider is connected."* A connection only shows **Connected** after the backend has checked the account with the provider's identity endpoint.
- **No AI provider is connected.** That is Phase 9.
- **No payment provider can move money.** Stripe accepts test-mode keys only, and PayPal uses the sandbox. Finance imports create *Unmatched* statement lines and nothing else.
- **Phase 7 (Documents) was never delivered.** File imports (Google Drive, OneDrive, Dropbox, Box) and signature envelopes (DocuSign, Dropbox Sign) report "requires Phase 7".

## Routes connected

All routes are under `/api/v1/integrations`. Every route needs:

- a session cookie;
- CSRF on writes;
- `organizationId` checked against an active membership;
- an RBAC grant per action (deny by default).

Portal logins have no membership and are refused.

| Area | Routes |
|---|---|
| **Catalog** | `GET /providers`, `GET /providers/:key`, `PATCH /providers/:key` (System Owner availability), `GET/PUT /providers/:key/app` (OAuth client registration; the secret is encrypted and never returned) |
| **Connections** | `POST /oauth/:provider/start`, `GET /oauth/:provider/callback`, `GET/POST /connections`, `GET/PATCH /connections/:id`, `GET /connections/:id/scopes`, `POST /connections/:id/{test, reauthorize, disconnect, pause, resume, rotate-credentials}` |
| **Sync** | `GET/POST /connections/:id/sync-configurations`, `POST /connections/:id/sync-preview`, `POST /connections/:id/sync`, `GET /sync-runs`, `GET /sync-runs/:id`, `POST /sync-runs/:id/cancel`, `GET /connections/:id/mappings` |
| **Actions** | `GET /connections/:id/actions`, `POST /connections/:id/actions/preview`, `POST /connections/:id/actions/execute` |
| **Conflicts** | `GET /conflicts`, `POST /conflicts/:id/resolve` |
| **Observability** | `GET /logs`, `GET /usage`, `GET /audit` (with `?connectionId=`), `GET /dead-letters`, `POST /dead-letters/:id/retry` |
| **Webhooks** | `POST /webhooks/:provider/:callbackId` (inbound, raw body, no session), `GET /webhooks`, `POST /connections/:id/webhook-subscriptions`, `POST /webhook-subscriptions/:id/rotate-secret`, `DELETE /webhook-subscriptions/:id` |
| **Outbound** | `GET/POST /outbound-webhooks`, `PATCH/DELETE /outbound-webhooks/:id`, `POST /outbound-webhooks/:id/{rotate-secret, test}` |
| **Policy** | `GET/PATCH /policies` |
| **Simulator** | `/simulator/*`, mounted only in simulator mode outside production. `npm run simulator` runs it as a standalone service. |

## Database models and migrations

Migration `20260925090000_phase8_integrations` adds 18 tables:

- **Providers and connections:** `IntegrationProvider`, `IntegrationProviderApp`, `IntegrationConnection`, `IntegrationCredential`, `IntegrationOAuthState`, `IntegrationPolicy`.
- **Sync:** `IntegrationSyncConfiguration`, `IntegrationSyncCheckpoint`, `IntegrationSyncRun`, `IntegrationRecordMapping`, `IntegrationConflict`.
- **Webhooks:** `IntegrationWebhookSubscription`, `IntegrationWebhookEvent`, `IntegrationOutboundEndpoint`, `IntegrationOutboundDelivery`.
- **Operations:** `IntegrationTask`, `IntegrationUsage`, `IntegrationLog`.

Other storage choices:

- Action previews reuse `IntegrationSyncRun` with `kind = "Action Preview"`, so no extra table is needed.
- Unique keys enforce idempotency:
  - mapping `(connectionId, providerEntityType, externalId)`;
  - webhook event `(subscription, providerEventId)`;
  - delivery `(endpoint, event)`;
  - task `dedupeKey`.

## Provider catalog

`providers/catalog.js` lists 61 providers. `npm run db:seed:integrations` seeds them idempotently; JSON is compared in canonical form, so re-running changes nothing.

- **Adapter (16):**
  - Productivity: Google Workspace, Microsoft 365, Slack.
  - Work tracking: GitHub, Jira, Asana, Trello, ClickUp.
  - Files and signatures: Dropbox, Box, DocuSign, Dropbox Sign.
  - Finance: Stripe, PayPal, QuickBooks Online, Xero.
  - Protocol facts (auth URLs, token style, identity endpoint, webhook scheme) come from each provider's documentation. QuickBooks' webhook scheme is marked unverified.
- **Catalog Only (40):** listed for reference; they can't be connected.
- **Blocked (5):** AI providers, until Phase 9.

## Provider adapter architecture

`providers/adapters/contract.js` defines one operation list:

- **Authorization:** `getAuthorizationUrl`, `exchangeAuthorizationCode`, `refreshCredentials`, `revokeCredentials`.
- **Identity and health:** `getConnectedIdentity`, `validateScopes`, `testConnection`.
- **Webhooks:** subscription create, renew and delete; `verifyWebhook`, `parseWebhook`.
- **Data:** `pullChanges`, `pushChanges`, `transformInbound`, `transformOutbound`.
- **Actions:** `performAction`, `readMessage`.
- **Utility:** `getRateLimitState`, `normalizeProviderError`.

`completeAdapter` fills every operation a provider lacks with an explicit *unsupported* result, never a silent no-op. `adapter.supports(op)` reports what is real.

The pieces are:

- `oauth2Adapter.js`: the shared OAuth 2.0 client.
- `liveAdapters.js`: identity and revocation per provider.
- `livePull.js`: change reading.
- `liveActions.js`: actions.
- `simulatorAdapter.js`: the simulator protocol.
- `registry.getAdapter(key, mode)`: picks the live or simulator adapter from the connection's mode, which never changes.

All provider HTTP goes through `common/http.js`, which handles timeouts, parses Retry-After and rate-limit headers, normalizes errors into kinds, counts usage and never logs bodies.

## Connection ownership

There are three ownership types, and the policy decides which are allowed:

- **User Connection:** personal; visible to its owner and to people with organization-level rights.
- **Organization Connection.**
- **Service Connection:** off by default.

Access rules:

- Visibility is enforced in queries with `connectionVisibilityWhere`.
- Actions through a personal connection (drafts, message links) are limited to the person who connected it.

A connection is **Connected** only after all of these:

1. authorization completed;
2. credentials encrypted and stored;
3. granted scopes compared with requested scopes;
4. the provider's identity endpoint called;
5. the external account recorded, with the verification time.

The other statuses are Ready to Connect, Authorization Pending, Connected with Warnings, Reauthorization Required, Rate Limited, Sync Paused, Disconnected, Revoked and Error.

## OAuth and PKCE

The Authorization Code flow is controlled entirely by the backend (`oauth/oauthService.js`):

- **PKCE:** S256.
- **State:** 256-bit, stored only as a hash. It is single-use, expires after 10 minutes, and is bound to the user, organization, provider and connection.
- **Nonce:** used where OpenID Connect applies.
- **Callback checks:**
  - it must be the same user and organization;
  - a replayed state is refused;
  - a different external account on reauthorization is refused (`different_account`);
  - scopes are verified.
- **Redirects:** only to the pre-registered frontend targets.
- **Logging:** the request log strips query strings on `/api/v1/integrations/`, so codes and state never reach logs.

## Credential encryption

`credentials/vault.js` uses AES-256-GCM with a random IV per secret. The associated data binds each ciphertext to its organization, connection or app, and credential type. A ciphertext moved to another row won't decrypt.

- **Where the master key lives:** outside the database, in `INTEGRATIONS_KEYS="1:<base64 32 bytes>"` or `INTEGRATIONS_KEYS_FILE`. `INTEGRATIONS_ACTIVE_KEY_VERSION` selects the key used for new data.
- **Startup:** the API and worker refuse to start without a key.
- **Dev key:** a fixed simulator key (version 0) is accepted only in simulator mode.
- **Master-key rotation:**
  1. Add the new version to the keyring.
  2. Set it active.
  3. Run `npm run integrations:verify-encryption -- --rewrap` to re-encrypt stored credentials.
  4. Remove the old version once `verify-encryption` reports no credential uses it.
- **Provider-credential rotation:**
  - refresh tokens rotate on every refresh (the old one is superseded);
  - `POST /connections/:id/rotate-credentials`;
  - `rotate-secret` for webhook and outbound signing secrets.
- **Exposure:** no endpoint returns a decrypted value. Only credential type, key version and expiry are shown.

## Scope management

- Requested scopes are the provider's required scopes plus those of the chosen capabilities, and only scopes the provider actually defines.
- `GET /connections/:id/scopes` shows required, requested, granted and missing scopes, plus each capability's state: *Available*, *Disabled — missing scopes*, or *Unavailable — requires Phase 7*.
- A capability with missing scopes can't sync or act; the fix is to reauthorize.
- When a provider grants fewer scopes than requested, the connection is marked **Connected with Warnings**.

## Integration Policies

`policies/policyService.js` holds one policy per organization. When none is stored, safe defaults apply:

- every adapter provider allowed;
- User and Organization connections only;
- **Import Only**;
- manual conflict resolution;
- admin approval;
- at most one scheduled sync every 15 minutes;
- raw payloads kept 7 days.

A policy can also:

- allow or block specific providers;
- allow ownership types and directions;
- add restricted fields and per-provider restrictions;
- disable integrations entirely.

Changes are versioned (optimistic locking) and audited.

## Data-egress protection

`filterOutbound` removes restricted fields at any depth before anything leaves: cost, margin, balances, internal notes, HR data, secrets, audit metadata, and anything the policy adds. It reports what was removed.

- **Outbound CRM webhooks** carry only event type, record type, record ID and time. Receivers fetch details through the API with their own permissions.
- **Actions** send exactly the previewed payload. Broadcast mentions (`@channel`, `@here`, `@everyone`) are removed. Recipients marked **Do-Not-Contact** (contact or lead) are refused.
- **Export actions** require the policy to allow *Export Only*.

## Initial sync preview

1. `POST /connections/:id/sync-preview` reads a bounded sample (up to 20 records).
2. It classifies each record as create, update, skip, conflict or tombstone, and estimates API usage.
3. It stores the plan as a preview run, *Awaiting Confirmation*, which expires after 30 minutes. **Nothing is written.**

The first sync, and any sync after an expired change token, needs `POST /connections/:id/sync {previewRunId, confirm: true}`. Each preview can be confirmed once.

- Two Way needs the policy, an adapter that can write, and `confirmTwoWay: true`.
- Finance capabilities are Import Only.

## Incremental synchronization

- Runs go through the fair task queue: at most one task per connection at a time, and two per organization.
- Each page is written in its own transaction.
- The checkpoint (the provider's change token) advances **only after the run completes**, so a failed run repeats safely.
- An expired token (HTTP 410) marks the checkpoint expired and asks for a new preview. A full resync never starts automatically.
- The worker schedules enabled configurations, refreshes tokens expiring within 10 minutes, and health-checks connections every 12 hours.
- Queued runs can be cancelled; committed records stay.

## Record Mappings

`IntegrationRecordMapping` links each external record to its CRM record and stores:

- the external version;
- inbound and outbound checksums over the mapped fields;
- sync state: Active, Conflict, Tombstoned or Disconnected;
- which side wrote last.

Replaying the same page is idempotent: unchanged checksums are skipped. Email links use the same table (`email_thread`), so a message can't be linked twice.

## Conflict resolution

When both sides changed since the last sync, an `IntegrationConflict` records both values; neither side wins automatically.

- **Resolutions:** Keep CRM, Keep Provider, Merge Selected Fields, Skip, or Disconnect Mapping, each with a required reason.
- **Restricted fields** can't be taken from the provider.
- **Who can see values:** people without resolve or sensitive-data rights see them masked.
- **Retention:** resolved snapshots are cleared after the retention period.

## Deletion and loop prevention

- **Provider deletions never delete CRM records.** The mapping is tombstoned, the run finishes *Completed with Warnings*, and the CRM record stays.
- **CRM deletions are never sent to providers** (No Deletions policy).
- **Loop prevention:** the last write origin plus checksums stop a change the gateway just wrote from bouncing back as a new change.
- **Two-way writes** use idempotency keys per run and record.

## Rate-limit and retry behavior

Every provider failure is classified by kind:

| Kind | Behavior |
|---|---|
| Rate limited | Waits for Retry-After or the rate-limit reset. The connection shows **Rate Limited** until then. |
| Transient (5xx, network, timeout) | Retries with exponential backoff and jitter. |
| Authentication invalid | Moves to **Reauthorization Required**; never retried. |
| Scope missing | Asks for reauthorization with the needed scope. |
| Permanent | Never retried. |

After repeated failures, the **circuit breaker** stops calls to that connection for a while. Exhausted tasks become **Dead Letter** and can be retried by hand.

## Inbound Webhooks

`POST /webhooks/:provider/:callbackId` (raw body, 256 KB limit):

1. An unknown callback gets 404.
2. The signature is verified with the subscription's encrypted secret. A bad signature or a stale timestamp (older than 5 minutes) gets **401 with no details**.
3. A duplicate event ID gets **200 `{duplicate: true}`** and is processed once.
4. A valid event is queued. Processing triggers an incremental sync; the webhook payload is never trusted as data.

- **Verification schemes:** Slack v0, GitHub sha256, Stripe, generic HMAC hex and base64, Asana hook secret, Box v2, Trello sha1, Graph clientState, channel token, Dropbox Sign event hash, and the simulator.
- **PayPal:** its webhook verification needs an API call, so its events are rejected locally.
- **Handshakes:** Graph validation and Slack URL verification are handled.
- **Retention:** raw payloads are redacted after the retention period.

## Outbound Webhooks

- **Endpoints:** HTTPS only. The signing secret is shown once, and only approved event types can be chosen.
- **Events** come from the audit trail at the moment of the change:
  - contact and company created, lead converted;
  - deal won, quote accepted, order confirmed;
  - ticket created and resolved;
  - task and project completed;
  - invoice and payment posted;
  - sync completed;
  - `webhook.test`.
- **Signature:** `X-Caspira-Signature: t=<ts>,v1=hex(HMAC-SHA256(secret, ts + "." + body))`, plus a delivery ID and event headers.
- **SSRF protection** (`outbound-webhooks/ssrf.js`):
  - refuses loopback, private, link-local, CGNAT, documentation, multicast and reserved ranges (IPv4, IPv6 and IPv4-mapped);
  - refuses credentials in URLs and non-standard ports;
  - DNS is resolved by the gateway and the connection is **pinned** to the checked address;
  - redirects are followed manually (at most 3), each one re-checked.
- **Retries:** 4xx (except 408 and 429) fails without retry. Otherwise it retries with backoff up to 6 attempts, then Dead Letter.

## Provider-specific adapters

**Identity and verification (all 16 adapter providers):**

- OAuth with the provider's token style: Jira JSON; DocuSign, QuickBooks and Xero basic auth; ClickUp raw token.
- Identity call and tenant choice (Jira sites, Xero organisations).
- Revocation where the provider supports it (Slack, GitHub, Dropbox, QuickBooks, Xero).
- API-key providers:
  - Stripe accepts **test-mode keys only**; live keys are refused before any call.
  - Trello uses key and token.
  - Dropbox Sign uses an API key.
  - PayPal uses **sandbox** client credentials.

**Live change reading (`livePull.js`):**

| Provider | What is read | How paging and checkpoints work |
|---|---|---|
| Google Calendar | events | `nextPageToken`, `nextSyncToken`; 410 means the token expired |
| Microsoft 365 | `calendarView` delta | `@odata.nextLink` and `@odata.deltaLink`, followed only on graph.microsoft.com |
| GitHub | issues of one repository | `since` plus Link-header paging; pull requests skipped |
| Stripe | balance transactions | `starting_after`, `created[gt]`; minor units converted |
| Xero | bank transactions | `Xero-tenant-id`, `If-Modified-Since` |

The cursor is opaque. The checkpoint is returned only on the last page.

**Actions (`liveActions.js`):**

- Slack `chat.postMessage` (unfurls off).
- Teams channel message.
- Gmail draft (RFC 5322, header-injection safe; **never sent**).
- Outlook draft (**never sent**).
- Gmail and Outlook message headers (`format=metadata` or `$select`; **no body**).

**Not connected in this phase:**

- Jira, Asana, Trello, ClickUp, PayPal and QuickBooks change reading. They connect and verify, and sync reports "can't read changes yet".
- All file imports and envelopes (Phase 7).

## Provider simulator

`simulators/simulatorCore.js` is deterministic and in-memory. It covers:

- OAuth authorize with auto-approve, a single-use code checked against PKCE and the redirect URI, and rotating refresh tokens;
- revocation and an identity endpoint;
- seeded calendar events, issues, transactions and email threads;
- cursor and delta paging; `deltaToken=expired` returns 410;
- idempotent `PATCH`;
- notify and draft actions (recorded, idempotent);
- channels;
- signed webhooks.

Test controls simulate rate limits, transient and permanent failures, reduced scopes, token expiry and revocation, and record edits and deletions.

How to run it:

- **In the API:** mounted at `/api/v1/integrations/simulator` when `INTEGRATIONS_MODE=simulator` and not in production.
- **As a service:** `npm run simulator` on port 4600; set `INTEGRATIONS_SIMULATOR_URL`.
- **Check script:** `npm run integrations:test-simulator` runs 11 database-free checks through the real adapter.

Simulator connections are labelled everywhere, including API responses, the connection page and the provider page, and never mix with live connections.

## Frontend Integration Center

`VITE_BACKEND_INTEGRATIONS_MODE=true`, now in `.env` and `.env.production`, switches the core Integration Center to the backend:

- `src/Helpers/backendIntegrationsClient.js` and `src/Helpers/integrationsBackend.js` map backend records onto the page shapes.
- **Marketplace and provider pages** show real availability (Ready to Connect, Not Configured, Unavailable with a reason) and the simulator label.
- **Connect:** the wizard starts OAuth and the browser goes to the provider (or simulator) sign-in. The return lands on the connection page with a connected or failed banner.
- **Connection page:**
  - real status and health issues;
  - Reauthorize;
  - Test, Pause and Resume;
  - Disconnect, which revokes access and cannot be undone;
  - **synchronization setup** per capability, **previews waiting for confirmation** with counts and "Confirm and synchronize", and cancelling queued runs;
  - sync history from real runs;
  - the per-connection audit trail.
- **Activity** comes from the audit trail.
- **Webhooks** shows inbound subscriptions and outbound endpoints.
- **Other Integration Center screens** refuse with a clear "isn't connected to the backend yet" message instead of showing demo data. These are Sales and Marketing, Support, Projects and Development, Commerce and Finance, Documents, and AI Providers.
- **Tests** pin the flag off (`vite.config.js`), so the suite still exercises the mock layer.

## RBAC and organization scope

Permission group **integrations** has these modules:

- `integration_catalog`, `_connections`, `_scopes`, `_policies`, `_sync`;
- `_conflicts`, `_webhooks`, `_outbound_webhooks`, `_logs`, `_credentials`, `_audit`.

They add the actions `create_user`, `create_organization`, `reauthorize`, `disconnect`, `preview`, `execute` and `rotate`. Grants for the seven built-in roles are in `server/prisma/builtInRoles.js`:

- **Standard Employee:** can make personal connections and sync, preview, run and cancel on their own; can view webhooks for their own connections.
- **Auditor / Checker:** read-only.

Scope rules:

- **Functional scope:** a capability that writes into Activities, Tasks or Reconciliation also needs that module's grant. For example, a Stripe import needs `reconciliation:create`, which Organization Administrator deliberately lacks.
- **Organization isolation:** every query is scoped by organization; other organizations' connections return 404.

## Sensitive-data protection

- **Tokens and secrets** are encrypted at rest and never returned, logged or audited. `scrub()` redacts token-like strings in log messages.
- **Error responses** carry a kind and a safe message only: no provider body, ORM detail or stack trace.
- **Inbound webhook errors** reveal nothing (`{"error":"rejected"}`).
- **Action previews** (a draft's recipients and body, message headers) are visible only to the person who prepared them.
- **Email linking** stores subject, sender, recipients and date, never the body. Security and sign-in messages are refused.

## Audit behavior

Append-only audit events (`integrations.*`) cover:

- connection start, callback, verification, scope changes, pause, resume, disconnect and credential rotation;
- policy and provider-app changes;
- sync configuration, preview, start, completion, failure and cancellation;
- conflict resolution;
- webhook subscriptions and rotations;
- outbound endpoint create, update, test, rotate and delete;
- action preview, execution and failure;
- denied and failed attempts.

`recordAuditEvent` now also notifies listeners without blocking; the outbound webhook emitter is one. Separately, `IntegrationLog` holds operational logs, kept 90 days.

## Docker Desktop verification

Development no longer uses Docker Desktop; the database and Redis run on the VPS through an SSH tunnel (see memory and `docs/VPS_DEV_SETUP.md`). Verification ran a temporary API on port 4100 in simulator mode against that database, with scripted live checks:

| Check | Result |
|---|---|
| OAuth: PKCE, state replay, wrong user, account binding, scopes, visibility | passed |
| Sync | 10/10 |
| Webhooks: inbound verify, replay, bad signature, stale timestamp, unknown callback; outbound delivery, HMAC, rotation, delete | 9/9 |
| Actions | 8/8 |
| Frontend contract endpoints | passed |
| Standalone simulator service | answers |

The sync checks covered: preview then confirm, worker path, incremental and idempotent runs, edits and tombstones, conflict with Keep Provider, rate limit, cancel, finance import to Unmatched lines, and logs without secrets.

The action checks covered: policy gate, mention removal, confirm-once by the preparer, provider error, Do-Not-Contact, personal-connection guard, email link with no double link and no security mail, and audit.

The production Docker image is unchanged apart from the new code. **Production needs the integration master key before deploying:** set `INTEGRATIONS_KEYS=1:<openssl rand -base64 32>` and `INTEGRATIONS_MODE=live`, then the URLs below.

## Tests executed

- **Server integration tests:** 74 passing (`npm run test:integration`), covering:
  - vault and catalog;
  - OAuth, simulator and connections;
  - sync;
  - webhooks and SSRF;
  - live pull for Google, Microsoft, GitHub, Stripe and Xero, with stubbed transport;
  - actions (mention removal, MIME header injection, endpoints, simulator idempotency).
- **Full server suite** (Phases 1–8): **477 tests in 61 files passing**.
- **Frontend:** 1,535 tests in 124 files passing, including new `integrationsBackend.test.js` mapping tests.
- **`npm run integrations:test-simulator`:** 11/11.

## Lint and build results

- **Frontend:** every file changed in this phase lints clean. The repository has **36 lint problems that existed before this phase** (the same count with this phase's changes stashed); they are not addressed here.
- **Production build** (`npm run build`) succeeds; the only warning is the existing chunk-size notice.
- **Server:** there is no ESLint setup for `server/` (the root config ignores it on purpose), so every integration file, route and script (51 files) was syntax-checked with `node --check` instead; all passed.

## Deferred functionality

- **Real-provider verification:** no live provider account has been connected or tested. Each needs its OAuth app registered (`PUT /providers/:key/app`) and a sandbox check.
- **Change reading** for Jira, Asana, Trello, ClickUp, PayPal and QuickBooks.
- **Two-way writes to live providers:** only the simulator has `pushChanges`.
- **Automatic webhook registration** at providers: the callback URL is shown to register by hand.
- **PayPal webhook verification** (needs the verify API call).
- **Phase 7 capabilities:** file imports, signature envelopes.
- **Per-field mapping editor** in the UI; mappings are fixed per capability.
- **API-key provider connect from the UI** (Stripe, Trello, Dropbox Sign, PayPal): the backend supports it via `POST /connections`, but the wizard handles OAuth only.
- **Frontend screens still mock-only:** Sales and Marketing, Support, Projects and Development, Commerce and Finance, Documents, and AI integration screens. They refuse in backend mode.
- **AI providers:** Phase 9.

## Configuration

| Variable | Purpose |
|---|---|
| `INTEGRATIONS_MODE` | `live` or `simulator` (simulator is refused in production) |
| `INTEGRATIONS_KEYS` / `INTEGRATIONS_KEYS_FILE` | Master keyring, `version:base64` comma-separated |
| `INTEGRATIONS_ACTIVE_KEY_VERSION` | Key version used for new encryption |
| `INTEGRATIONS_PUBLIC_API_URL` | Public API base (OAuth callback and webhook URLs), e.g. `https://api.caspirasolutions.com` |
| `INTEGRATIONS_FRONTEND_URL` | Where OAuth results return, e.g. `https://caspiracrm.caspirasolutions.com` |
| `INTEGRATIONS_SIMULATOR_URL` | Use a standalone simulator service |
| `INTEGRATIONS_ALLOW_PRIVATE_WEBHOOK_TARGETS` | Development only: allows local outbound targets |

Commands: `npm run db:seed:integrations`, `npm run integrations:verify-encryption [-- --rewrap]`, `npm run integrations:test-simulator`, `npm run simulator`, `npm run test:integration`.
