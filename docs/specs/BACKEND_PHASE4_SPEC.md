# Backend Phase 4 — Support, Conversations, Tickets, Knowledge Base and SLA Management

This is a condensed checklist of the owner's "Back-end (IV)" prompt, the
source of truth for this phase. Every requirement is kept; the wording is
shortened.

## Boundary: do NOT implement

- Integrations: Gmail/Outlook, WhatsApp, Messenger, Instagram, Telegram, Slack, Teams, Twilio/SMS, live chat or call-center providers.
- Delivery: production email sending.
- AI: automatic AI replies, AI summaries, Claude or OpenAI, sentiment analysis.
- Automation: automatic resolution, automatic compensation.
- Other phases: real file storage, Project or Finance persistence, payments.
- Also out: public unauthenticated ticket submission, hard deletion.
- Mailpit is allowed for local development notifications only.
- Never claim a message was delivered when no provider is connected.

## Models and rules

- **IDs and numbering:** stable public IDs; `TICKET-YYYY-NNNNNN` numbers that are per-organization, safe under concurrency, never reused and searchable.
- **Support Inbox:** name, description, `channelType` (Manual, Customer Portal, Internal, Email Placeholder, Chat Placeholder), default queue, active, customer-visible display name, created and updated by, version, archived. Placeholder channels are marked disconnected, and there are no inbound webhooks.
- **Queue:** name, description, department, team, default SLA policy, active, `assignmentMode`, audit fields, version, archived.
- **Queue Membership:** queue, membership, role in the queue, active, capacity. The agent must be an active member of the same organization.
- **Assignment:**
  - Manual, queue, unassign, reassign, followers.
  - Optional deterministic round-robin: active members only, respects capacity, concurrency-safe, records why an agent was picked, and a manager can override. It isn't described as AI.
  - Never assigns across organizations.
- **Ticket fields:**
  - inbox, queue, subject, description, status, priority, category, subcategory, source;
  - requester contact and company, portal account, assignee, owner, department, team;
  - related lead, deal, order and contract;
  - entitlement, SLA policy snapshot, first-response due and resolution due;
  - firstResponseAt, resolvedAt, closedAt, reopenedAt;
  - waiting reason, resolution code, resolution summary, customer-visible status;
  - created and updated by, version, archive and archive reason.
  - All related records must be in the same organization, and linked internal records are never exposed to the portal.
- **Priorities:** keep the frontend's set, with documented meanings. A priority change recalculates future SLA deadlines and never rewrites a breach that already happened.
- **Statuses:**
  - Keep the frontend's statuses where they exist, and enforce valid transitions.
  - Resolving needs a code or summary; cancelling and reopening need a reason; closing needs a permission.
  - The portal can reply to reopen only if policy allows it.
  - Internal notes never count as a public response.
  - Every transition creates a Ticket Event and an audit event. Tickets are never resolved automatically.
- **Messages:**
  - Types: customer message, agent public reply, internal note, system event, status event.
  - Visibility: Customer visible, Internal only, Restricted management.
  - Each message stores a sanitized body, source, delivery status (Not Applicable, Local Preview, Pending Provider, Delivered to Portal, Failed — never "Sent"), edited date, archived date and version.
- **Internal notes:**
  - Never in portal responses or customer exports, and never delivered to the customer.
  - Restricted notes need their own permission.
  - Sanitized, and edits use a version check.
  - Excluded at query and serialization level, not just hidden in the UI.
- **Ticket Events (append-only):** create, assign, reassign, priority, category, status, queue, SLA applied, paused, resumed, warning and breach, public reply, note, customer reply, resolve, close, reopen, entitlement change, relationship change, CSAT. Each stores label snapshots.
- **Categories:** organization-scoped with parent subcategories; name, normalized name, description, active, order, default queue and default priority, archived. Archived categories stay visible on old tickets but can't be picked for new ones.
- **Followers:** same organization, no duplicates, following doesn't widen access (scope is still checked), removal is audited.
- **Portal Account:**
  - Fields: user, organization, contact, company, status, invited, activated, suspended, created by, last access.
  - Linked only by an administrator, and the user can never choose their own contact or company.
  - Suspension blocks access immediately.
  - No internal notes, audit data, owners, cost or margin, or unrelated CRM data.
- **Portal Tickets:**
  - The customer can list and view their own tickets, create a ticket for their account, reply, see public replies and the customer-visible status, read published KB articles, and submit CSAT once.
  - The customer can't assign, change queue or priority, see notes, other companies' tickets, or another contact's private tickets (unless company-wide access is granted), see SLA configuration or audit history, or close, archive or merge.
- **Entitlement:**
  - Company, contract, name, description, SLA policy, effective start and end, support level, allowed channels, active, version.
  - Must be in the same organization. An expired contract grants nothing.
  - Selection is deterministic. A manual override needs a permission and a reason, and changes are audited.
- **SLA Policy (versioned):**
  - Name, description, active, business-hours calendar, time zone, targets per priority (first response, next response, resolution) in **explicit units**, pause conditions, warning thresholds, effective dates, archived.
- **Business Hours Calendar:**
  - IANA time zone, handles DST, working days, several intervals per day with no overlaps, holidays and closures, effective dates, version.
  - A snapshot is kept for historical tickets, and the browser's time zone is never used.
- **SLA Clock:**
  - Ticket, policy version, target type, started, due, paused, accumulated pause, completed, breached, state (Running, Paused, Met, Breached, Cancelled), last calculated.
  - First response is the first customer-visible agent reply; notes and system events don't count.
  - The pausing statuses are documented (for example Pending Customer pauses resolution).
- **SLA worker:**
  - Detects warnings and breaches (first response, next response, resolution) and resumes paused clocks.
  - Creates internal notifications and idempotent events, and doesn't lose breaches when the worker was down.
  - Never resolves tickets, changes priority or sends customer messages.
- **KB Category:** slug, parent, visibility, order, active, archived.
- **KB Article:** number, category, title, slug, summary, current version, status, visibility, author, reviewer, published and archived dates, version.
- **KB Article Version:**
  - Number, title and summary snapshots, sanitized body, change note, author, review status, reviewer, review date and reason.
  - Lifecycle: Draft → In Review → Approved → Published → Archived.
  - Published versions are immutable, and a material edit creates a new version.
  - Review and publish need their own permissions, with separation of duties.
  - Only published, authorized articles reach the portal; internal articles never do. Slugs are unique per organization.
- **Canned Response:** name, body, visibility, queue scope, category scope, audit fields, version, archived. It fills a draft and never sends anything.
- **CSAT:** organization, ticket, portal user or contact, rating (range defined), comment, submitted, valid state, moderation. One per eligible ticket and requester, the relationship is checked, employees can't submit as the customer, comments stay private, and there are no public reviews.
- **Related and merge:**
  - Deterministic signals: same requester or company, similar subject, same category, close in time, same contract or order.
  - Never merges automatically.
  - A manual merge shows a preview, needs a permission, a reason, a transaction and an idempotency key, keeps the destination and archives the source as merged with its history.

## APIs (under `/api/v1`)

- **Inboxes:** `support/inboxes` — list, create, get, update, archive.
- **Queues:** `support/queues` — list, create, get, update, archive, plus members (list, add, remove).
- **Tickets:** `support/tickets` — list, create, get, update, `assign`, `transition`, `resolve`, `close`, `reopen`, `archive`, `restore`, `events`, `related`, `bulk`.
- **Messages:**
  - `tickets/:id/messages`, `tickets/:id/replies`, `tickets/:id/internal-notes`
  - `support/messages/:id` (update), `support/messages/:id/archive`
- **SLA:**
  - `support/sla-policies` — list, create, get, update, `new-version`, `archive`
  - `support/business-hours` — list, create, update
  - `support/entitlements` — list, create, get, update
- **Knowledge Base:**
  - `support/kb/categories` — list, create, update
  - `support/kb/articles` — list, create, get, update, `submit`, `approve`, `publish`, `archive`, `versions` (get and post)
- **Portal:**
  - `portal/support/tickets` — list, create, get, replies, satisfaction
  - `portal/knowledge-base/categories`, `portal/knowledge-base/articles`, `portal/knowledge-base/articles/:slug`
  - Dedicated serializers.

## Permissions (deny by default)

- **Inboxes and queues:** `support.inboxes.read/manage`, `support.queues.read/manage`.
- **Tickets:** `support.tickets.read/create/update/assign/transition/resolve/close/reopen/archive/merge/bulk`.
- **Messages:** `support.messages.public.create`, `internal.read/create`, `restricted.read`.
- **SLA and entitlements:** `support.sla.read/manage`, `support.entitlements.read/manage`.
- **Knowledge Base:** `support.kb.read/create/review/publish/archive`.
- **Other:** `support.canned_responses.read/manage`, `support.csat.read`, `support.reports.read`, `support.audit.read`.

Role behavior:

- **System Owner:** only the explicitly selected organization.
- **Organization Admin:** manages settings.
- **Department Manager:** departmental queues and tickets.
- **Support Manager:** assigned queues.
- **Agent:** assigned, followed, queue-visible or shared tickets.
- **Sales roles:** linked tickets only when explicitly allowed, and never notes.
- **Auditor:** read-only history and SLA evidence.
- **Portal user:** portal endpoints only.

## Reports (deterministic, authorized first)

- **Counts:** open, new, unassigned; by status, priority, queue and agent; waiting for the customer; waiting internally.
- **Times and SLA:** first-response time, resolution time, first-response and resolution SLA compliance, active and upcoming breaches.
- **Other:** reopened, backlog aging, volume by company and by contract, CSAT average and count, KB usage (if views are recorded).
- Every rate shows its denominator, "insufficient data" is shown instead of a small-sample percentage, and nothing is labelled AI.

## Other requirements

- **Fixture import:** idempotent, keeps IDs, maps CRM and Sales records and members, validates, never runs automatically in production, and produces a report.
- **Frontend adapters:** tickets, messages, events, queues, SLA, KB, canned responses, portal, CSAT, reports. They show version conflicts, prevent duplicate replies, keep mock mode behind a flag and never fall back to mock silently.
- **AI preview:** only authorized deterministic summaries, labelled "Frontend Analysis Preview".
- **Version checks (optimistic concurrency):** ticket edit, assign, transition, reply edit, SLA versions, entitlements, article edit, review and publish.
- **Idempotency keys:** ticket create, public reply, customer reply, resolve, close, reopen, CSAT, publish, merge.
- **Audit:** every setting, membership, ticket, message, SLA, entitlement, portal link and suspension, article, canned response, merge and CSAT change, plus unauthorized access attempts. Personal data is redacted.

## Tests and security

The prompt lists about 110 test cases (see the original). Security must hold for:

- cross-organization access, and portal users choosing IDs;
- notes excluded from portal responses at query level;
- counts and search excluding unauthorized records;
- bulk actions keeping record scope;
- HTML sanitization;
- client timestamps never satisfying an SLA;
- honest delivery status;
- canned responses that don't send;
- KB visibility enforced by the backend;
- CSAT only for related tickets;
- no private messages in logs, and no stack traces in errors.
