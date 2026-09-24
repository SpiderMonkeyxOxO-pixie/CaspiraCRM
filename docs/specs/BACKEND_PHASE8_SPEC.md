# Backend Phase 8 — External Integrations, OAuth Connections, Webhooks and Provider Synchronization

This is a condensed checklist of the owner's "Back-end (VIII)" prompt, the
source of truth for this phase. Every requirement is kept; the wording is
shortened.

**Note:** the prompt assumes Phase 7 (Documents, Object Storage, File
Security, E-Signatures) is complete, but the Back-end (VII) prompt was never
provided. So file imports (Drive, OneDrive, Dropbox, Box) and signature
envelope mapping (DocuSign, Dropbox Sign) are refused with a "requires Phase 7
quarantine and scanning" capability result, never faked.

## Connection boundary

- **States:** Not Configured, Configuration Incomplete, Ready to Connect, Authorization Pending, Connected, Connected with Warnings, Reauthorization Required, Rate Limited, Sync Paused, Disconnected, Revoked, Error.
- **Connected** only after all of these:
  - authorization completed;
  - credentials encrypted;
  - scopes verified;
  - authenticated identity or health call succeeded;
  - external account confirmed;
  - verification date recorded.
- **Simulator mode** is always labelled *"Provider Simulator — no external provider is connected."*
- Without credentials, a provider shows *"Not Configured — provider credentials have not been supplied."*

## Boundary: do NOT implement

- **AI:** Claude, OpenAI, Gemini, prompts, analysis, AI-generated messages, autonomous actions.
- **Automatic business actions:**
  - permission changes, deletions, duplicate merges;
  - Contract activation, Quote approval, Order confirmation, Invoice posting;
  - payment initiation.
- **Money:** card collection, bank credential storage.
- **Bulk ingestion:** mailbox or Drive without explicit scope or selection, and unrestricted Slack/Teams ingestion.
- **Surveillance:** employee surveillance of any kind.
- **Secret handling:**
  - no secrets in frontend code;
  - no tokens in localStorage;
  - no plaintext credentials in PostgreSQL.
- **Unsafe processing:** unverified webhook processing, arbitrary user code, silent two-way sync, silent external deletion.
- **Frontend:** don't redesign the Integration Center or remove mock/simulator mode.

## Providers

- Real adapters only for providers already in the frontend catalog, in priority order:
  1. Google Workspace (Gmail, Calendar, Drive), Microsoft 365 (Outlook, Calendar, OneDrive);
  2. Slack, Teams;
  3. GitHub, Jira, Asana, Trello, ClickUp;
  4. Dropbox, Box, DocuSign, Dropbox Sign;
  5. Stripe, PayPal, QuickBooks, Xero.
- **Finance providers** are sandbox, read or import only, can't pay, and never post without a human.
- **Each adapter** uses the official docs and supported OAuth, and pins and records its API version. It documents its scopes, webhook signature and rate limits. No guessed scopes.
- **Adapter contract:**
  - `getAuthorizationUrl`, `exchangeAuthorizationCode`, `refreshCredentials`, `revokeCredentials`;
  - `getConnectedIdentity`, `validateScopes`, `testConnection`;
  - `create/renew/deleteWebhookSubscription`, `verifyWebhook`, `parseWebhook`;
  - `pullChanges`, `pushChanges`, `transformInbound/Outbound`;
  - `getRateLimitState`, `normalizeProviderError`.
  - An unsupported operation returns an explicit capability result.
- **Provider catalog (DB):**
  - key, name, category, description, icon, API version, auth type, ownership types, capabilities;
  - required and optional scopes;
  - webhook, incremental and sandbox support;
  - docs and status URLs;
  - data categories and sensitive warning;
  - active flag, adapter version, timestamps.
  - No credentials in the catalog.

## Models

- **Connection:**
  - identity: id, public id, organization, provider, name;
  - ownership (User / Organization / Service), connected user and membership;
  - external account id and label, tenant or workspace;
  - status, granted and requested scopes, capability state, credential reference;
  - dates: connected, verified, last sync ok, last sync failed, reauth required, paused, revoked;
  - created/updated by, version, timestamps.
  - An Organization connection needs elevated permission; a user connection never silently becomes shared.
- **Credentials:**
  - AES-256-GCM: ciphertext, nonce, tag, key version, type, expiry, rotation metadata;
  - the master key lives outside PostgreSQL (Docker secret or env), never reaches the frontend or logs, and supports rotation;
  - startup fails when it's missing, outside simulator mode.
  - **Rotation:** key versions, token refresh, refresh-token replacement, client-secret and webhook-secret rotation, reauthorization, revocation, audit.
  - An invalid refresh token moves the connection to Reauthorization Required, with no retry loop.
- **OAuth:**
  - Authorization Code + PKCE;
  - random state, nonce, expiry, single use, stored server-side;
  - exact redirect URI;
  - bound to organization, user, provider and scopes;
  - replay prevention for both code and callback;
  - generic error pages, no tokens in logs;
  - no implicit flow, no frontend exchange.
  - **Callback:** validate state and user, exchange code, encrypt, get identity, validate scopes, store account, audit, redirect to a safe frontend route.
  - **Prevents:** login CSRF, connection swapping, org substitution, open redirect, state and code replay, injection, scope escalation, wrong-account linking.
  - Only pre-registered redirect targets.
- **Scopes:** show required, optional, granted, missing, capabilities disabled and the last check. Least privilege. Increasing scopes needs reauthorization.
- **Integration Policy:**
  - allowed and blocked providers, allowed ownership types;
  - data categories, sync directions;
  - sensitive-field and provider-specific restrictions;
  - admin approval, default conflict policy, max sync frequency, retention;
  - enabled, version.
  - Changes need elevated permission and are audited.
- **Data egress:**
  - checks in order: org, actor, connection, ownership, policy, scopes, field permissions;
  - restricted fields removed;
  - preview and confirmation where sensitive;
  - purpose recorded and audited.
  - **Restricted:** product cost, margin, discount thresholds, balances, private notes, HR, audit metadata, signature evidence, auth info, unneeded personal data.
- **Sync Configuration:**
  - connection, capability, entity type;
  - direction (Import Only / Export Only / Two Way), source of truth;
  - filters, date range, field mapping;
  - conflict and deletion policy, schedule, enabled;
  - checkpoint, created/updated by, version.
  - **Defaults:** Import Only, manual initial sync, no deletions either way, manual conflicts, no restricted fields.
  - Two-way is never enabled silently.
- **Initial sync preview:**
  - test the connection and scopes, take a bounded sample, normalize, apply policy;
  - detect duplicates and conflicts;
  - show create / update / skip, restricted fields excluded, API usage;
  - needs confirmation and can be cancelled.
  - Never a full mailbox, Drive or workspace.
- **Incremental sync:**
  - uses delta tokens, cursors, timestamps, or webhook-then-fetch;
  - **Checkpoint:** cursor, watermark, last event, last success, version;
  - advances only after commit; failed batches can be retried; replay is idempotent;
  - an expired cursor leads to a controlled resync preview, never a silent full resync.
- **Record Mapping:**
  - org, connection, provider entity type, external id, external version/ETag;
  - CRM entity and id, in and out checksums, last synced, state;
  - unique on (connection, entity type, external id); no cross-org mappings.
- **Conflict:**
  - created when both sides changed since the last sync;
  - stores fields, CRM and provider values (redacted), status, choice, resolver, date, reason;
  - resolutions: Keep CRM, Keep Provider, Merge Selected, Skip, Disconnect Mapping;
  - resolved by a person; restricted data is never silently overwritten.
- **Deletion:** a provider deletion creates a tombstone or warning, never a hard delete. A CRM deletion never deletes externally. Archiving needs a preview. External deletion is a separate explicit capability.
- **Loop prevention:** ETags, checksums, origin metadata, idempotency keys, event ids, correlation ids, suppression windows.
- **Sync Run:**
  - connection, capability, trigger, direction, start and end;
  - statuses: Queued, Running, Paused, Completed, Completed with Warnings, Failed, Cancelled, Rate Limited;
  - counts discovered, created, updated, skipped, conflicts, failures;
  - rate-limit state, checkpoints before and after, initiator, correlation id.
  - Raw payloads aren't kept indefinitely.
- **Worker:**
  - jobs: refresh, health, incremental sync, webhook processing and renewal, retries, dead letters, outbound delivery, usage;
  - partitioned by org, connection and capability, with fairness.
- **Rate limits:** provider parsing, Retry-After, exponential backoff with jitter, max retries, concurrency, per-connection and per-org throttles, circuit breaker, pause and resume, visible status. Permanent errors are never retried.
- **Inbound webhooks:**
  - **Subscription:** connection, provider id, capability, callback id, secret ref, expiry, renewal, status.
  - **Event:** org, connection, provider, event id, type, signature valid, received, provider timestamp, status, attempts, processed, safe error, payload expiry.
  - **Verification:**
    - keep the raw body, check the signature and timestamp tolerance;
    - resolve the connection; reject unknown, replayed and invalid events; size limit;
    - respond fast, enqueue, process asynchronously;
    - never mutate data before verification.
  - **Replay protection:** unique event id, timestamp, nonce, payload hash, idempotent processing, retained ids.
  - **Local dev:** signed-webhook simulator, fixtures, replay tests, docs for an optional user-run tunnel. No automatic tunnel, and no claim of public delivery.
- **Outbound webhooks:**
  - **Endpoint:** HTTPS (except local), event types, signing secret with rotation, timeout, active, created by.
  - **SSRF protection:** block loopback, private, link-local and reserved ranges; resolve and revalidate DNS; guard against rebinding; limit and revalidate redirects.
  - **Payload:** body limit, HMAC with timestamp and delivery id, no credentials, egress policy applied.
  - **Delivery record:** endpoint, event, delivery id, attempt, timestamp, status, duration, result, next retry, safe error. No full response bodies kept.

## Provider-specific boundaries

- **Gmail / Outlook:** user connection, explicit mailbox scope, explicit linking. No full import, no automatic sending (draft or preview first). Respect Do-Not-Contact. Delivery id only after provider confirmation. Never import auth or security emails.
- **Calendars:** calendar selection, mapping to activities or events, time zone preserved, incremental, conflicts, attendee preview. No automatic invites or deletions.
- **Drive / OneDrive / Dropbox / Box:** explicit file selection, metadata preview, Phase 7 quarantine, malware scan, checksum, source reference, permission-aware. No mirroring.
- **Slack / Teams:** human-approved notifications to a chosen workspace and channel, with preview, delivery status and restricted-field filtering. No ingestion; no personal or financial data without policy.
- **GitHub / project tools:** selected repos or projects, explicit Issue↔Task mapping, incremental, source of truth, conflicts, verified webhooks. No private content to unauthorized users; no automatic close.
- **Signature providers:** sandbox, Phase 7 envelope mapping, encrypted credentials, verified webhooks, external evidence kept. Contract activation stays separate; no legal-validity claim.
- **Finance providers:** sandbox, read-only import, reconciliation preview, human confirmation before creating Finance records. No payments, cards or automatic journals. Provider ids and versions kept.

## Permissions (deny by default)

- **Catalog and connections:** `integrations.catalog.read`, `integrations.connections.read/create_user/create_organization/update/reauthorize/disconnect`.
- **Scopes and policies:** `integrations.scopes.read`, `integrations.policies.read/manage`.
- **Sync and conflicts:** `integrations.sync.read/configure/preview/execute/cancel`, `integrations.conflicts.read/resolve`.
- **Webhooks:** `integrations.webhooks.read/manage`, `integrations.outbound_webhooks.manage`.
- **Logs and admin:** `integrations.logs.read`, `integrations.sensitive.read`, `integrations.credentials.rotate`, `integrations.audit.read`.

Roles:

- **System Owner:** manages provider availability; never sees decrypted tokens.
- **Org Admin:** org connections and policies; can't use blocked providers.
- **Department Manager:** department connections, where granted.
- **Functional managers:** their own module's sync.
- **Regular user:** a personal connection if policy allows; can't share it.
- **Auditor:** read-only.
- **Portal user:** no access.

## APIs (under `/api/v1/integrations`)

- **Providers:** `providers` (list and get).
- **Connections:** `connections` (list, create, get, patch); `test`, `reauthorize`, `disconnect`; `scopes`.
- **OAuth:** `oauth/:provider/start` (POST) and `callback` (GET).
- **Sync:** `sync-configurations` (get and post), `sync-preview`, `sync`, `sync-runs` (list, get, cancel).
- **Conflicts:** list and `resolve`.
- **Inbound webhooks:** `webhooks/:provider/:callbackId`.
- **Outbound webhooks:** list, create, patch, `rotate-secret`, `test`, delete.
- No endpoint ever returns a decrypted credential.

## Other requirements

- **Audit:** everything listed in the prompt, including invalid signatures, replays, restricted-data exclusions and unauthorized access. Never logs tokens, codes, secrets, raw state or full payloads.
- **Retention:** OAuth state, raw payloads, webhook events, sync logs, failed and dead-letter jobs, conflict snapshots, delivery logs. Raw payloads are redacted after retention; audit metadata is kept.
- **Commands** (adapted): `db:seed:integrations`, `integrations:verify-encryption`, `integrations:test-simulator`; a provider-simulator service.
- **Frontend Integration Center adapters:**
  - catalog, details, connections, connect, callback result, scopes, configuration;
  - test, preview, sync, pause, resume, reauthorize, disconnect;
  - runs, conflicts, webhooks, usage, audit.
  - Never exposes secrets, never mixes simulator and live, never silently falls back.
- **Tests:** about 120 cases (see the original), plus the security verification list.
- **Report:** use the prompt's report headings, then stop for approval before Phase 9.
