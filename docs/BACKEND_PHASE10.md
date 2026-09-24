# Backend Phase 10 — AI Copilot, Conversation Memory, Permission-Aware Retrieval and Governed Workflows

Status: implemented and verified in simulator mode against the development database. **Not deployed** (deployment is deferred until all backend phases are finished). No live AI provider has been verified from this phase; with `AI_MODE=simulator` every answer is labelled "AI Provider Simulator — no external AI provider is connected."

What this phase is not: the Copilot is not autonomous, it has no provider-side memory, it never completes an action on its own, and the CRM backend is not complete (Backend Phase 7 Documents is still missing, so document tools report "unavailable").

## How a turn works

1. **Accept.** An assistant message is created as `Queued`, and the request returns `202` with an SSE URL. Pass `wait: true` to block instead.
2. **Policy.** The organization's AI policy and the `copilot.chat` use case must be enabled; otherwise the turn is refused.
3. **Prohibited requests.** Delete, archive, merge, send email/SMS, approvals, payments, refunds, permission changes, signing and bulk export are answered without any model call, with an explanation of who can do it instead.
4. **Context.** Records attached to the conversation are read first with exact lookups.
5. **Plan.** A structured-output call (`copilot.plan`) returns tool requests. The model sees only the tool catalog this user is allowed to use.
6. **Authorize and run tools.** For each requested tool the backend checks:
   - the tool is on the allowlist;
   - `ai_copilot_tools:view` plus the tool's module grant;
   - the sensitive-data grant, where the tool needs it;
   - organization, owner, team and department fields are stripped from the model's arguments;
   - the arguments pass a zod schema;
   - repeats are limited.

   The tool then runs through the **existing domain handlers with the user's identity**, so record visibility is exactly what the user sees in the CRM.
7. **Text search.** Semantic search over indexed notes, activities, Knowledge Base articles, customer-visible ticket messages, projects and contract text. Every hit is re-checked through its handler before use.
8. **Confirmation gates.** Organization-wide reads and sensitive Finance data pause the turn (`Awaiting tool`) until the user confirms.
9. **Answer.** A structured-output call (`copilot.answer`) receives evidence handles `E1…En` and must cite them.
10. **Citation validation.** Every cited record is re-read through its handler (up to 20, five at a time):
    - Unknown or invented handles are dropped.
    - Records that were deleted, or that the user can no longer open, are dropped.
    - A statement whose numbers aren't in a cited record is removed.
    - Changed records are marked `Stale`.

    The summary sentence may not claim actions, introduce unsupported figures or echo instructions.
11. **Confidence** (High / Medium / Low / Insufficient Data) is computed from these facts, never from a model score. **Limitations** are listed on the message.
12. **Proposals.** Suggested actions become Phase 9 governed proposals (`Awaiting Confirmation`). Nothing is executed by the Copilot.
13. **Memory.** A model suggestion becomes a `Proposed` preference only after validation; the user accepts or rejects it.
14. **Compaction.** Long conversations are compacted into a labelled summary; the last 6 turns stay verbatim.

**Per-turn limits:** 3 model calls, 10 data requests, 1 identical repeat, 60 records, 120 s, 0.50 USD estimated.

## Routes connected (`/api/v1/ai/copilot`)

| Area | Routes | Permission |
|---|---|---|
| Info | `GET /copilot` | `ai_copilot:use` |
| Conversations | `GET/POST /conversations`, `GET/PATCH/DELETE /conversations/:id`, `POST …/archive`, `POST …/restore` | read: `ai_copilot_conversations:view_own` or `view_audit_history`; write: `ai_copilot:use` |
| Messages | `GET/POST /conversations/:id/messages`, `GET /messages/:id`, `GET /messages/:id/events` (SSE), `GET /messages/:id/citations`, `POST /messages/:id/cancel`, `POST /messages/:id/regenerate`, `POST /messages/:id/feedback` | as above |
| Context | `GET /context/search`, `POST /conversations/:id/context`, `DELETE /conversations/:id/context/:contextId`, `GET /conversations/:id/scope` | `ai_copilot:use` |
| Clarifications / data access | `POST /clarifications/:id/answer`, `POST /tool-calls/:id/approve` | `ai_copilot:use` |
| Memory | `GET/POST /memory`, `PATCH/DELETE /memory/:id`, `POST /memory/:id/expire` | `ai_copilot_memory:configure` |
| Workflows | `GET /workflows`, `POST /workflows/:key/run`, `GET /workflow-runs/:id`, `POST /workflow-runs/:id/{cancel,resume,approve,reject}` | `ai_copilot_workflows:execute` |
| Index | `GET /index`, `POST /index/rebuild`, `POST /index/sources/:type/:id/reindex`, `DELETE /index/sources/:type/:id` | `ai_copilot_index:configure` |

Every route also requires an organization membership. A System Owner without a membership in the organization gets `403 COPILOT_MEMBERSHIP_REQUIRED`.

## Database models and migrations

Migration `20260925200000_phase10_ai_copilot` adds 19 tables:
- **Conversations:** `AiCopilotConversation`, `AiCopilotMessage`, `AiCopilotMessagePart`, `AiCopilotCitation`, `AiCopilotContextLink`.
- **Tools:** `AiCopilotToolCall`, `AiCopilotToolResult`.
- **Memory:** `AiCopilotMemory`, `AiCopilotMemoryEvent`.
- **Retrieval:** `AiRetrievalQuery`, `AiRetrievalResult`, `AiSourceChunk`, `AiSourceEmbedding`, `AiIndexingJob`.
- **Workflows:** `AiWorkflowTemplate`, `AiWorkflowVersion`, `AiWorkflowRun`, `AiWorkflowStep`, `AiClarificationRequest`.

Vectors are stored as `real[]` in the existing PostgreSQL. No pgvector image change was needed; search is an exact cosine scan filtered by organization.

## Tool registry

- **Read tools** (registry version 1, at most 25 records each). Each tool is listed with the grant it needs:

  | Tools | Grant |
  |---|---|
  | search/get for leads, contacts, companies, deals, quotes, orders, contracts (also expiring within N days), support tickets, projects | the module's grant |
  | `get_pipeline_metrics` (deterministic; own scope, or organization scope after confirmation) | `sales_reports:view` |
  | `search_activities`, `get_overdue_activities`, `search_tasks` | the module's grant |
  | `search_invoices` (needs confirmation) | sensitive data |
  | `search_knowledge_base` | the module's grant |
  | `get_current_user_scope` | none |

- **Unavailable:** `search_documents` and `get_document_excerpt` return "unavailable" until Backend Phase 7.
- **Proposal tools** map onto Phase 9 action types, so every change goes through preview, confirm, approve and undo:
  - `propose_create_follow_up`, `propose_schedule_meeting`, `propose_add_next_action`, `propose_update_expected_close_date`, `propose_assign_owner`, `propose_request_missing_information`, `propose_start_renewal_review`;
  - `propose_review_duplicate` is always refused, because merging is never done through AI;
  - `propose_open_records` produces links only.

## Retrieval and indexing

**Indexed sources:**

| Source | What is indexed |
|---|---|
| Knowledge Base | published articles |
| Activities | activities |
| CRM notes | notes; permission is checked through the parent record |
| Tickets | subject, description and **Customer Visible** messages only |
| Projects | projects |
| Contracts | customer-facing fields only |

**Chunking and masking:** chunks are 800 characters with a 100-character overlap, at most 20 per record. Emails, phone numbers and tokens are masked before storage.

**Keeping the index current:**
- Changes to an indexable record (seen through the audit trail) queue a reindex job; the worker processes jobs every 10 s.
- An hourly sweep catches anything missed.
- Rebuild the index with `npm run copilot:index -- --rebuild`.

**Embeddings:**
- `AI_EMBEDDING_PROVIDER=simulator`: a deterministic 256-dimension hashing model. This is the default in simulator mode.
- `AI_EMBEDDING_PROVIDER=openai` with `AI_EMBEDDING_MODEL` and `AI_EMBEDDING_VERSION`: uses the organization's OpenAI connection, and usage is recorded as `copilot.embedding`.
- `disabled`: the default in live mode until an embedding model is chosen. Answers then carry the limitation "Text search … is turned off."

**Permissions at query time:**
1. Organization filter.
2. Embedding model and version.
3. Allowed record types (from the user's module grants).
4. Own-scope filter.
5. A handler re-read of each hit.

Provider-hosted retrieval stays off.

## Memory

Only allowlisted preferences can be remembered:
- summary length;
- currency display;
- report style;
- default analysis scope;
- preferred Copilot mode.

Values containing emails, phone numbers, money, credentials or HR/health terms are refused (`422`). A model suggestion is stored as `Proposed` and becomes `Active` only when the user accepts it. Every change is logged in `AiCopilotMemoryEvent`. Memories expire (180 days by default, at most 730). Memory never includes customer data.

## Workflows

The six templates are declarative and versioned; version 1 is seeded by `npm run db:seed:ai`, which also stores its checksum.

| Template | What it does |
|---|---|
| `company_briefing` | resolves the company; asks when a name matches several |
| `meeting_preparation` | prepares for a meeting with a company |
| `pipeline_review` | own pipeline, or organization-wide with confirmation |
| `renewal_review` | reviews contracts coming up for renewal |
| `data_quality_review` | deterministic rules; proposes "request missing information" corrections |
| `daily_preparation` | deterministic urgency ranking |

**Limits per run:** 14 steps, 12 data requests, 150 s, 0.75 USD estimated. Runs expire after 24 h.

A run pauses at `Awaiting clarification`, `Awaiting tool approval` or `Awaiting action confirmation`. Runs are idempotent (`Idempotency-Key`), and an identical run already in progress is returned instead of a duplicate.

## Streaming and cancellation

SSE events, in order: `accepted`, `checking_permission`, `resolving_context`, `searching`/`calculating`, `preparing_answer`, `validating_citations`, then `completed` / `failed` / `cancelled` / `waiting_confirmation`.

**Stop:**
1. The message is marked `Cancelled` at once.
2. The in-flight gateway request is cancelled, including one that starts after Stop.
3. The turn stops at its next checkpoint and never stores an answer.
4. Usage already incurred stays recorded.

The frontend follows SSE and also polls, for proxies that buffer streams.

## Privacy, RBAC and audit

**Who can see a conversation:**
- Conversations are private to their owner; anyone else gets `404`.
- Holders of `ai_copilot_conversations:view_audit_history` can read another person's conversation read-only, and each such read is audited.

**Default grants** (from Phase 10 Step 1):

| Role | Copilot grants |
|---|---|
| Administrator / System Owner | everything |
| Team Leader | standard, plus workflow approval |
| Checker | audit reading and tool view only |
| User / Accountant | standard |
| Finance Manager | standard, plus sensitive fields |

**Audited events:** prohibited requests, denied tool calls, tool approvals, workflow start/cancel/approve/reject, conversation deletion, index rebuilds and source removal, and flagged feedback.

**Deleting a conversation:**
- deletes its parts, citations, context, clarifications and cached tool results;
- blanks the text of its messages and retrieval logs;
- keeps audit metadata and never touches CRM records.

## Retention (worker, every 5 minutes)

These defaults extend the AI policy's `retention` settings:

| Data | Retention |
|---|---|
| Conversation content | 365 days (`copilotConversationDays`) |
| Cached tool results | 30 days (`copilotToolResultDays`) |
| Retrieval logs | 90 days (`retrievalLogDays`) |

The same 5-minute worker job also:
- expires workflow runs and memories;
- marks answers left running by a restart as failed after 10 minutes.

## Frontend

With `VITE_BACKEND_AI_MODE=true`, `/ai/copilot` renders `src/pages/AI/copilotBackend/AiCopilotBackend.jsx`.

**Conversations:**
- a conversation list with search, archive and delete;
- modes, and a record-context picker that lists only authorized records;
- starters, the simulator banner and the disclaimer.

**Each answer shows:**
- live progress and a Stop button;
- findings with source chips that open an evidence drawer (with an "Open record" link);
- confidence, limitations, freshness and estimated cost;
- actions: regenerate, feedback, and proposal Confirm/Cancel (showing the live status);
- clarification choices, data-access confirmations and memory accept/reject.

**Dialogs:** workflows and memory.

**Audit view:** read-only.

**Layout and accessibility:** below `md` the conversation list is a drawer. Controls are labelled, and dialogs trap focus.

Without the flag, the existing mock Copilot is unchanged.

## Configuration

| Variable | Purpose |
|---|---|
| `AI_MODE` | `simulator` (dev/test) or live. As in Phase 9. |
| `AI_EMBEDDING_PROVIDER` | `simulator` / `openai` / `disabled` |
| `AI_EMBEDDING_MODEL`, `AI_EMBEDDING_VERSION` | needed for `openai` embeddings |
| `COPILOT_INDEX_INTERVAL_MS` | worker indexing interval (default 10000) |
| `VITE_BACKEND_AI_MODE` | frontend backend mode (as in Phase 9) |

AI provider keys are added in **Administration → Integrations → AI Providers**, not in `.env`.

## Commands

```
npx prisma migrate deploy            # applies 20260925200000_phase10_ai_copilot
node scripts/seedRoles.js            # Copilot permissions on built-in roles
npm run db:seed:ai                   # Copilot prompt templates and workflow templates
npm run copilot:index -- --rebuild   # index existing records (the worker keeps it current)
npm test                             # server tests
```

## Tests executed

**Server unit tests: `src/ai/copilot/copilot.test.js` (19)**
- tool allowlist;
- tool and module grants;
- identity-field stripping;
- argument schemas;
- sensitive grants and confirmation;
- organization-scope confirmation;
- a tool catalog filtered by permission;
- proposal tools that are never destructive;
- memory allowlist and sensitive-value refusal;
- confidence computed from facts;
- citation shape;
- evidence handles, deduplication and record shaping;
- chunking with masking;
- simulator embeddings (deterministic, normalized, similarity-preserving);
- detection of prohibited requests;
- plan/answer output schemas;
- bounded, checksummed workflows.

`governance.test.js` was updated because `copilot.chat` is no longer reserved.

**Frontend: `src/pages/AI/copilotBackend/AiCopilotBackend.test.jsx` (6)**
- empty state with starters, simulator label and disclaimer;
- validated answer with a source drawer and an "Open record" link;
- a proposal runs only on Confirm;
- a memory is saved only on acceptance;
- sending shows progress, and Stop works;
- the audit view is read-only.

**Live checks (27/27)** ran against the development database through the API in simulator mode:
- info and simulator label;
- a pipeline answer with validated citations and confidence;
- messages, parts and routes;
- refusal of prohibited requests;
- unknown-tool denial;
- stripping of injected `organizationId`/owner;
- removal of invented and uncited statements;
- an action claim that is not shown as done;
- a governed proposal, then cancelling it;
- memory proposed only, with sensitive suggestions never stored;
- memory accept, refuse and delete;
- privacy (404 for another user; read-only audit view);
- no sensitive Finance data without the grant;
- Finance data after confirmation;
- idempotency;
- Stop;
- the SSE event sequence;
- regenerate and feedback;
- record context;
- pipeline review, company briefing and data-quality workflows;
- no workflow grant gives 403;
- index rebuild (97 chunks and vectors) with semantic citations;
- conversation deletion;
- Copilot disabled by policy.

In the first full run, 25 of 27 passed. The two memory checks hit an Active preference left from an earlier run. After the script cleared the user's memories first, both passed.

**Development database latency:** about 430 ms per query through the SSH tunnel, so a turn took 25–55 s during these checks. On the production host the database is local.

## Deferred

- **Document tools and document indexing:** they wait for Backend Phase 7 (Documents).
- **A live embedding provider:** it is off in live mode until one is chosen and verified.
- **Rollout controls:** evaluation dashboards for Copilot quality, safety-operations tooling and production rollout controls belong to Phase 11.
