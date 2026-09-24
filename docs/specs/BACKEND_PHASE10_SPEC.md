# Backend Phase 10 — AI Copilot, Conversation Memory, Permission-Aware Retrieval and Governed Workflows

This is a condensed checklist of the user's **Back-end (IX)** Google Doc tab. The tab is titled IX but its prompt is Phase 10.

The Copilot at `/ai/copilot` (nav label "AI Copilot") runs through the Phase 9 gateway. It is a permission-aware business assistant, not a generic chatbot.

## Reuse

The Copilot reuses what already exists:

- auth, organizations, RBAC and record scope, field masking;
- domain services (CRM, Sales, Support, Projects, Finance);
- the Phase 9 governed actions, audit, notifications (outbox), vault and worker;
- the Phase 9 gateway, simulator, usage, budgets, policies and evaluations.

It never replaces the service layer with model-generated queries.

## Never

The Copilot never:

- touches the database directly, runs SQL, or receives database credentials;
- reaches unauthorized or other-organization records, or uses hidden records in totals;
- reveals masked fields;
- mutates, deletes, archives or merges anything;
- sends email, SMS or chat;
- approves, confirms, activates, pays, refunds or signs anything, or changes permissions;
- runs bulk exports without approval;
- browses the web, installs packages, runs shell commands or arbitrary code;
- creates unrestricted tools, runs unbounded loops, or sets autonomous goals;
- stores chain-of-thought, or trusts instructions found in retrieved content.

## Principles

Advisory, evidence-based, permission-aware, explainable, provider-neutral, human-controlled, cost-aware, auditable, and honest about uncertainty, missing data and provider status.

Every material answer covers: what was found, supporting records, freshness, what's missing, confidence, suggested action, and the permission or approval required.

## Modes and use cases

| Mode | Covers |
|---|---|
| Ask about CRM | Summaries, open Deals, qualified Leads without Deals, needs-attention, no recent communication, overdue follow-ups, at-risk explanation |
| Account (Company) briefing | Contacts, Deals, Activities, follow-ups, Quotes, Orders, Contracts, Tickets, Projects, Documents (requires Phase 7), risks, missing info, preparation |
| Meeting preparation | Suggested agenda items are labelled as suggestions |
| Pipeline review | Stages, weighted pipeline, stale deals, past close date, no next action, high value, concentration, owner workload, data-quality limits. **Deterministic selectors** |
| Renewal review | Contracts expiring, notice deadlines, owners, source Orders, values, open issues, activity, missing info |
| Data-quality assistant | Proposes corrections only |
| Work preparation | Daily summary, follow-ups, task priority, project status, escalations, collections (authorized roles), document/policy lookup |

Don't create insight types for modules that aren't implemented.

## States

**Conversation:** Active, Archived, Locked, Deleted, Retention pending, Provider unavailable, Restricted.

**Message:** Queued, Classifying, Retrieving, Awaiting tool, Generating, Validating, Completed, Completed with limitations, Cancelled, Refused, Failed, Stale.

**A conversation belongs to:** an organization and a user, plus optional Department, Team, Company, Contact, Lead, Deal, Project, Ticket, Contract and workspace context. It is never reassigned across organizations.

## CRM-managed conversation state

The CRM stores all of it: conversations, messages, citations, tool calls and results, proposals, workflow runs, memory references, usage, provider request IDs and prompt versions.

**Provider-managed state is off by default.** Enabling it requires:

- policy approval, and showing the storage mode to administrators;
- recording the provider conversation ID and encrypting restricted metadata;
- retention and deletion support, and no cross-organization reuse;
- a CRM recovery copy.

Anthropic continuity uses CRM-managed history.

## Memory

**Three levels:**

1. **Turn context:** expires with the generation.
2. **Conversation memory:** recent messages, selected records, filters, an approved summary, citations, open questions.
3. **Durable user memory:** preferences only (summary length, currency display, report style, default scope, preferred mode). It is visible, editable, deletable, organization-bound, source-attributed, timestamped, expirable, and excludes sensitive categories.

**Never saved automatically:** contact PII, financial values, HR, health, authentication data, credentials, private document content, unverified conclusions, temporary states, guesses, sensitive customer info.

**Approval:** a proposed memory shows source, intended use, sensitivity, expiry, and Save / Edit / Do not save. Never saved just because the model asked. Business facts stay on their records. Provider memory stays off.

**Compaction** is deterministic:

- **Keeps:** goal, decisions, selected records, filters, citations, pending proposals, limitations, open questions.
- **Drops:** obsolete tool output, duplicates, superseded drafts, expired snapshots, provider metadata.
- The summary is labelled as a summary, and history is never overwritten.

## Retrieval

**Order of steps:**

1. authenticate → organization → Copilot permission;
2. classify → record scope → modules → fields → authorization;
3. structured retrieval, then semantic retrieval if needed;
4. rerank → strip restricted fields → context limits → evidence handles;
5. provider → validate → verify citations → store → usage → stream.

Authorization always happens **before** semantic results reach the model.

**Structured retrieval** goes through domain services: Leads, Contacts, Companies, Activities, Deals, Pipelines, Products, Price Books, Quotes, Orders, Contracts, Tickets, Knowledge Base, Projects, Tasks, Time, Invoices, Payments, Expenses, Documents (Phase 7), and integration records.

**Semantic retrieval** covers KB, notes, activity descriptions, approved transcripts, contract clauses, project descriptions and support conversations. It is **never** the source of totals, permissions, ownership or states.

**Vectors:**

- **Storage:** existing PostgreSQL; pgvector preferred when operationally compatible. Here, embeddings are stored as `real[]` with exact cosine search. There's no separate vector database.
- **Record fields:** organization, module, record type and ID, source version, chunk ID, text or reference, embedding model and version, sensitivity, permission metadata, created/updated/deleted dates, index status.
- **Every query filters by organization and authorization.** Never search globally and then filter.

**Embedding adapter:** approved OpenAI configuration, an alternative provider, a deterministic simulator, or disabled. No hard-coded model. Model and version are stored per vector; changing the model runs a versioned reindex job. No mixed dimensions.

**Indexing jobs** run on create, update and delete of indexed sources, and on permission or sensitivity changes. They:

- extract only approved text and keep section metadata;
- chunk deterministically, respecting organization boundaries and field restrictions;
- skip quarantined or unsupported content and never index secrets;
- remove vectors when the source is deleted, and record failures.

**Provider-hosted retrieval** (OpenAI File Search) is optional, off by default, and needs extra approvals.

**Quality features:**

- search: keyword and semantic, with filters by date, type, company, owner and module;
- ranking: recency, exact-ID priority, reranking, dedupe and limits;
- chunking: citation-friendly;
- a named record is resolved by exact authorized lookup first.

## Tools

**Read tools:**

- search_/get_ for leads, contacts, companies, deals, quotes, orders, contracts, support tickets, projects;
- get_pipeline_metrics, search_activities, get_overdue_activities;
- search_tasks, search_invoices;
- search_documents and get_document_excerpt (Phase 7);
- search_knowledge_base, get_current_user_scope.

**Proposal tools:**

- propose_create_follow_up, propose_schedule_meeting, propose_assign_owner;
- propose_update_expected_close_date, propose_add_next_action;
- propose_review_duplicate, propose_create_deal, propose_start_renewal_review;
- propose_request_missing_information, propose_open_records.

Proposal tools create proposals only.

**Policy check on every tool call:** organization, user, role, permission, record and field scope, module, allowlist, input schema, result size, sensitivity, conversation and workflow context, budget, rate limit.

Organization, user, owner, department and team always come from the server, never from the model.

**Tool results:** JSON with authorized IDs, safe labels, freshness, no hidden fields, truncation info, no stack traces or secrets.

**Confirmation needed before:** broad organization-wide reads, sensitive Finance data, restricted documents, large exports, sensitive cross-module reports, any proposal, any external communication, anything destructive.

## Orchestration

A backend state machine with limits on:

- provider calls, tool calls and repeated calls;
- retrieved records, context size and output size;
- runtime, cost, retries and workflow steps.

The backend owns tool policy, authorization, execution, approval pauses, retries, cancellation, persistence, usage and final validation.

## Workflows

Versioned templates, immutable once published:

- Company briefing
- Meeting preparation
- Pipeline review
- Renewal review
- Data-quality review
- Daily work preparation

**Run states:** Draft, Ready, Running, Awaiting clarification, Awaiting tool approval, Awaiting action confirmation, Awaiting approver, Completed, Completed with limitations, Cancelled, Failed, Expired.

**Each step records:** type, input, scope, tool, output reference, dates, status, error category, usage, approval state. Only concise operational reasons are stored, never chain-of-thought.

**Clarification** is required for:

- duplicate names or an ambiguous scope;
- a missing date range, an action without a target, or incomplete values;
- restricted data, or currencies that can't be combined;
- an unresolved Company or Deal.

Clarification choices only ever offer authorized records.

## Action proposals

Reuse the Phase 9 system. The preview shows everything the Phase 9 preview shows.

**Flow:** model proposes → backend validates → preview → user confirms → approver where required → domain service executes → audit → verified result → undo where supported.

**Prohibited** (never automatic): delete, archive, merge, send, approve Quotes or discounts, confirm Orders, activate Contracts, pay, refund, change permissions, sign, publish private documents, export unrestricted data, HR decisions. The Copilot explains why, who is authorized, and the manual workflow.

## Citations and confidence

**A citation contains:** ID, record type and ID, safe label, field or section, value (or masked state), timestamp, source version, authorized route and retrieval method.

**UI:** inline markers, evidence chips, an evidence drawer, open record, copy reference.

**Never cite:** records the user can't open, deleted records, unverified stale vectors, provider text as evidence, unfinished routes, hidden fields.

**Validation:** resolve the citation, then recheck organization, authorization, existence and version; check the field supports the claim; mask; drop unsupported citations; reject unsupported material claims. A citation that later becomes unauthorized marks the old answer restricted or stale.

**Confidence levels:** High, Medium, Low, Insufficient Data. Calculated from coverage, completeness, freshness, deterministic calculation, conflicts, missing fields, restricted data and retrieval quality. No fake decimals.

**Limitations are always shown:** missing modules, incomplete data, stale records, restricted information, truncation, multiple currencies, refusal, provider unavailable, partial workflow.

## Streaming

**SSE events:**

- accepted, checking permission, resolving context, searching;
- calculating, preparing, waiting for confirmation, validating citations, completed.

**Draft text:** optional, sanitized, never claims actions, replaced by the final answer, and never stored as final.

**Stop:** cancels tools and the provider call, records usage, never marks the message complete, and keeps earlier messages.

## Frontend `/ai/copilot`

**Page contents:**

- breadcrumb "AI Intelligence / AI Copilot", title, provider status, scope, record context, mode;
- conversation list, new conversation, search;
- composer, stop, regenerate;
- evidence drawer, workflow progress, action preview;
- memory controls, freshness, usage (authorized roles).

**Empty state:** focused starters plus the disclaimer "AI Copilot uses authorized CRM data and may make mistakes. Verify important information and approve actions before they are applied."

**Composer:** text, record context picker, module, scope, date range, attach an authorized document, remove context, send, stop. No direct uploads to providers; unavailable modules are disabled.

**Response:** direct answer, key findings, evidence, confidence, freshness, missing information, next actions, feedback, copy, open records.

**Conversations:** rename, archive, restore, delete (retention), search, filter (date, module, company, mode), continue, start from a record. Private to the owner unless the viewer has audit permission, which is audited.

**Feedback:** Helpful, Not Helpful, Incorrect, Unsafe, Missing evidence, Dismiss, plus reasons. It never retrains a model.

## RBAC

| Role | Copilot access |
|---|---|
| System Owner | Platform policy, tools and templates; no automatic tenant data |
| Organization Administrator | Organization policy, memory rules, usage, conversation review per policy |
| Executive | Organization-level work |
| Department Manager / Sales Manager | Team and department scope |
| Sales Representative | Assigned records |
| Auditor / Checker | Read-only review; can't confirm |
| Portal user | Only when enabled, and only their own account |

**Sensitive data rule:** hidden values are never revealed; the Copilot says "Additional restricted information is available to authorized roles."

## Prompt-injection protection

Instruction/data separation, source labels, sanitization, size and MIME limits, detection and logging, allowlists, strict schemas, limits, citation verification, approval checkpoints and output validation.

## Usage and cost

Use Phase 9 accounting, attributed to organization, user, conversation, message, workflow, provider, model, tools, retrieval and embeddings.

Show provider, model, reported usage, estimated cost (never labelled a charge), budget remaining, and whether provider storage is on. A reservation is made before each step, and a hard limit stops the run.

## Models (equivalent)

`ai_copilot_conversations`, `messages`, `message_parts`, `citations`, `context_links`, `tool_calls`, `tool_results`, `memories`, `memory_events`, `ai_retrieval_queries`, `ai_retrieval_results`, `ai_source_chunks`, `ai_source_embeddings`, `ai_indexing_jobs`, `ai_workflow_templates`, `ai_workflow_versions`, `ai_workflow_runs`, `ai_workflow_steps`, `ai_clarification_requests`.

Every table has an organization boundary, plus the listed indexes.

## APIs (under `/api/v1/ai/copilot`)

| Area | Endpoints |
|---|---|
| Conversations | CRUD, archive, restore |
| Messages | list, send, cancel, regenerate, events (SSE), citations, feedback |
| Context | search, add, remove, scope |
| Memory | CRUD, expire |
| Workflows | list, run, get, cancel, resume, approve, reject |
| Index | status, rebuild, reindex source, delete source |

## Permissions

- `ai.copilot.use` (+ `.own`, `.team`, `.department`, `.organization`)
- `ai.copilot.conversation.read.own` and `.read.audit`
- `ai.copilot.memory.manage.own`
- `ai.copilot.tool.read.standard` and `.read.sensitive`
- `ai.copilot.workflow.run` and `.approve`
- `ai.copilot.action.propose` and `.confirm`
- `ai.copilot.index.manage`, `ai.copilot.policy.manage`

## Retention

**Covered:** conversations, messages, drafts, tool inputs and outputs, citations, memories, retrieval logs, embeddings, workflow events, provider metadata.

**Deleting a conversation:** removes or anonymizes content, deletes provider state, keeps audit, removes conversation memory and provider files, and never deletes CRM records.

**Deleting a source:** invalidates its chunks.

## Docker / simulator

The default stack works without keys.

**The simulator supports:** multi-turn, tool requests, clarification, citations, workflow steps, proposals, invalid citations, injection, refusal, timeout, rate limit, cancellation.

**Documented commands:** migrations, seeding permissions and templates, fixture indexing, the simulator, tests, logs, rebuilding the index.

## Accessibility and responsive

- **Accessibility:** heading hierarchy, keyboard use, live announcements, focus management and trapping, keyboard Stop, text labels, reduced motion, contrast.
- **Responsive:** 360 to 1920 px; history in a drawer and evidence in a sheet on mobile; no horizontal overflow; composer always visible.

## Tests

About 150 listed, covering all of the above (see the original prompt).

## Definition of done and report

Use the prompt's headings. Don't claim autonomy, connection without verification, provider memory, completed actions, or a complete CRM backend.

After this phase, stop for approval before **Phase 11 — AI Governance, Safety Operations, Evaluation Management and Production Rollout**.
