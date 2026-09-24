# Backend Phase 9 — AI Gateway, Provider Billing, OpenAI/Claude Integration and Governed AI Actions

Prompt: [docs/specs/BACKEND_PHASE9_PROMPT.md](specs/BACKEND_PHASE9_PROMPT.md). Code: `server/src/ai/`.

**Status to read first**

- **OpenAI and Claude adapters are built but not connected.**
  - Both are built to the providers' documented APIs and tested against stubbed HTTP.
  - **Neither has been verified with a real key yet.** Every end-to-end check ran against the **AI Provider Simulator**. It is labelled *"AI Provider Simulator — no external AI provider is connected."* everywhere it appears.
  - A provider shows **Connected** only after the server has verified the organization's key with the provider and found an approved model.
- **Costs are estimates, not provider charges.** They come from versioned price tables and are labelled *"Estimated — not a provider invoice"*.
- **No action runs without a person.** Nothing is executed until a person confirms it, and some actions also need an approver. Execution goes through the CRM's existing business handlers.
- **Phase 7 (Documents) was skipped.** Nothing here reads documents.

## Routes connected

All routes are under `/api/v1/ai`. Every route needs:

- a session cookie;
- CSRF on writes;
- `organizationId` checked against an active membership;
- an RBAC grant per action.

The early, unscoped gateway (`services/ai/aiGatewayService.js`, `providerRegistry.js`, `providers/*`, Bearer-only `/ai/*`) is **removed**.

| Area | Routes |
|---|---|
| **Providers and connections** | `GET /providers`, `GET /providers/:key`, `GET/POST /connections`, `GET/PATCH/DELETE /connections/:id`, `POST /connections/:id/{verify, rotate-key, disable, enable}` |
| **Models, use cases, routing** | `GET /models`, `GET /model-aliases`, `PUT /model-aliases/:alias`, `GET /use-cases`, `PATCH /use-cases/:key`, `GET /routing-policies`, `PUT /routing-policies/:useCase` |
| **Policy and privacy** | `GET/PATCH /policy`, `GET/PUT /redaction-rules`, `POST /context-preview` |
| **Generation** | `POST /narrative`, `POST /explore` (both migrated), `GET /requests/:id`, `GET /requests/:id/events` (SSE), `POST /requests/:id/cancel`, `POST /feedback` |
| **Usage, pricing, budgets** | `GET /usage`, `GET /usage/summary`, `GET /price-tables`, `PUT /price-tables/:provider`, `GET/POST /budgets`, `PATCH /budgets/:id` |
| **Governed actions** | `GET /actions`, `POST /actions/preview`, `POST /actions/suggest`, `GET /actions/:id`, `POST /actions/:id/{confirm, approve, reject, cancel, undo}` |
| **Evaluations and audit** | `GET/POST /evaluations/scenarios`, `GET/POST /evaluations/runs`, `GET /evaluations/runs/:id`, `GET /audit` |
| **Simulator** | `/simulator` and `/simulator/_control/{fail, delay, reset}`, only in AI simulator mode outside production |

## Database models and migrations

Migration `20260925150000_phase9_ai_gateway` adds 24 tables:

- **Providers and models:** `AiProvider`, `AiProviderConnection`, `AiModel`, `AiModelAlias`, `AiPriceTable`, `AiPriceEntry`.
- **Organization settings:** `AiUseCase`, `AiRoutingPolicy`, `AiPolicy`, `AiRedactionRule`.
- **Prompts:** `AiPromptTemplate`, `AiPromptTemplateVersion`.
- **Requests and usage:** `AiRequest`, `AiRequestEvent`, `AiUsageRecord`.
- **Budgets:** `AiBudget`, `AiBudgetReservation`.
- **Governed actions:** `AiActionProposal`, `AiActionApproval`, `AiActionExecution`.
- **Evaluations and feedback:** `AiEvaluationScenario`, `AiEvaluationRun`, `AiEvaluationResult`, `AiFeedback`.

Other storage points:

- Every tenant table carries `organizationId`.
- API keys reuse the Phase 8 `IntegrationCredential` store (`credentialType = "ai_api_key"`), so master-key rotation (`integrations:verify-encryption -- --rewrap`) covers them.
- Indexes: organization and date, organization/user/use case, provider request ID, budget period, proposal state, evaluation state.

## AI provider catalog

`src/ai/catalog.js` is seeded with `npm run db:seed:ai`, which is idempotent.

- **Adapter:** OpenAI, Anthropic (Claude), and OpenRouter (off by default, because it forwards data to third-party hosts).
- **Catalog Only:** Gemini, Azure OpenAI, Ollama.
- **Always available outside production:** the labelled AI Provider Simulator.
- **Models:** suggestions only. Verification replaces them with what the key can actually use.
- **Prompt templates:** versioned and immutable once published. The seeder reports a changed text instead of overwriting it.

## Adapter architecture

One contract (`adapters/contract.js`):

- `verifyCredentials`, `listModels`;
- `generate` (text, structured output, tool requests, streaming, cancellation through `AbortSignal`);
- `embed` (declared as unsupported in this phase);
- `normalizeUsage`, `normalizeError`, `getRateLimitState`.

`completeAiAdapter` fills anything a provider lacks with an explicit *unsupported* result.

All provider HTTP goes through `common/http.js`, which provides deadlines, Retry-After parsing, error classification into ten categories, SSE parsing and a swappable transport. Tests never reach the network.

`registry.getAiAdapter(key, mode)` chooses the adapter: Simulator-mode connections always use the simulator, and Live connections never do.

## OpenAI adapter

`adapters/openaiAdapter.js` uses the Responses API (`POST /v1/responses`):

- `instructions` and `input`, `max_output_tokens`;
- **`store: false` unless the organization's policy enables provider storage**;
- JSON-schema text format for structured output;
- function tools, whose calls are returned and never executed;
- SSE streaming (`response.output_text.delta`, `response.completed`);
- refusal detection;
- usage normalization (including cached tokens);
- verification through `GET /v1/models`.

## Anthropic adapter

`adapters/anthropicAdapter.js` uses the Messages API (`POST /v1/messages`, `anthropic-version: 2023-06-01`):

- structured output as a forced `emit_result` tool;
- other tools returned as requested calls;
- the message rebuilt from SSE events;
- `stop_reason: refusal` detected;
- usage including cache reads;
- verification through `GET /v1/models`.

No provider-side memory or storage feature is used.

## AI provider simulator

`adapters/simulatorAdapter.js` runs in-process and deterministically, and sees only what a real provider would see.

**Supports:**

- verification and model listing (when standing in for a provider, it lists that provider's catalog models);
- text, where the narrative returns the deterministic draft and sentences that look like injected instructions are dropped;
- structured findings that cite only supplied records;
- a `propose_action` tool request;
- streaming and cancellation;
- reported usage.

**Switches, written in the prompt:**

- `[sim:refuse]`
- `[sim:timeout]`
- `[sim:invalid-json]`
- `[sim:rate-limit]`
- `[sim:error]`

**Controls** (queued failures, delay, reset) are available only in simulator mode outside production.

**Mode:** `AI_MODE` is `simulator` by default outside production and `live` in production. The simulator is refused in production at startup.

## Connection verification

A connection's status moves through **Ready to Verify → Connected / Connected with Warnings / Verification Failed / Rate Limited / Error**.

**Connected** requires all of:

- the key encrypted and stored;
- an authenticated models-list call;
- at least one **approved** model (catalog or organization alias) available to the key;
- the verification date and model list recorded.

Other rules:

- **Connected with Warnings:** the key works, but some default alias models aren't available to it.
- **Re-verification:** runs daily in the worker.
- **Rotation:** supersedes the old key and re-verifies.
- **Disable/enable:** enabling re-verifies.
- **Remove:** revokes the stored key.
- **Exposure:** keys are never returned; only the last four characters are shown as a hint.

## Credential encryption

API keys use the Phase 8 vault: AES-256-GCM, bound to organization, connection and credential type, with the master key outside the database (`INTEGRATIONS_KEYS`).

Keys never appear in responses, logs or audit events. Audit data passes through `scrub()`, which redacts key-like fields and token patterns.

## Models, aliases and routing

- **Aliases:** features ask for an **alias** (fast, balanced, deep, structured). An alias maps to a model per provider per organization. Changes are versioned and audited, and only catalog or key-verified models are accepted.
- **Use cases** (`overview.narrative`, `overview.explore`, `action.proposal`, `evaluation.run`, and `copilot.chat` reserved for Phase 10 and locked off) each define:
  - allowed aliases;
  - input and output limits;
  - allowed data classifications;
  - whether tools and streaming are allowed.
- **Routing:** each use case has a primary provider and alias, plus an optional fallback. Without stored routing, simulator mode uses the simulator; live mode uses the first usable connection (Anthropic, then OpenAI, then OpenRouter).
- **Fallback conditions:** a fallback is used only for provider-side failures (unavailable, timeout, rate limited), only when configured, and only if the fallback may receive every data classification present.
- **No simulator fallback in live mode.**

## AI policies

`AiPolicy` is created with safe defaults the first time it's changed. It controls:

- **Enablement:** AI on or off.
- **Scope:** allowed providers and use cases.
- **Data:** allowed classifications per provider, plus extra restricted fields.
- **Personal data:** Mask, Pseudonymize or Exclude.
- **Provider storage and memory:** both off. Turning either on requires `confirmProviderRetention: true`.
- **Rate limit:** requests per person per hour.
- **Approvals:** which action types need an approver.
- **Retention periods.**

Changes are version-checked and audited. Restricted and Secret data can never be allowed.

## Data classification and redaction

- **Eight classifications:** Public, Internal, Confidential, Restricted, Personal, Sensitive Personal, Financial, Secret.
- **Field names** are classified by exact name and by substring (email, phone, secret, token, key, margin, salary and similar).
- **Before any provider call:**
  - built-in and policy-restricted fields are removed at any depth;
  - Restricted and Secret are always removed;
  - classifications the provider or use case may not receive are removed;
  - fields hidden from the user are removed;
  - the rest follow the organization's rule (Allow, Mask, Pseudonymize, Remove).
- **Recording:** only removed and masked field *names* are stored.
- **Context preview:** `POST /context-preview` shows exactly what would be sent. Nothing is sent.

## Context assembly and prompt-injection protection

- **Data separation:** record data goes only inside `<data> … </data>` blocks. The system text says such content is untrusted, and data can't close or forge a block (escaped).
- **Clean-up:** HTML is stripped and control characters removed; strings are limited to 4,000 characters.
- **Size limits:** the largest arrays are halved until the request fits the use case's limit; otherwise the request is refused.
- **Injection handling:** injection patterns are flagged and audited (`ai.prompt_injection.detected`) but stay inert. They cover ignore-instructions, reveal-secrets, role override, cross-tenant, destructive commands, exfiltration and execute.
- **Output check:** an answer that repeats injection-style instructions is flagged (`suspicious_output`). The AI Overview then shows the deterministic summary instead.

## Structured output validation

- **Schemas:** each has a JSON Schema (sent to the provider) and a Zod schema (checked by the gateway). Invalid output is discarded, audited (`ai.output.validation_failed`) and reported as an error, never shown.
- **Narrative:** keeps the numeric guardrail (no number the facts don't contain) and falls back to the deterministic summary when:
  - a new number appears;
  - the model claims it performed an action;
  - suspicious output is detected;
  - the answer is empty;
  - the model refused.
- **Explore:** citations and suggested actions must reference records that were actually sent.

## Streaming and cancellation

- **Streaming:** `POST /narrative {stream: true}` returns a `requestId`. `GET /requests/:id/events` (SSE) replays persisted progress events:
  accepted → policy → routing → context → budget → provider → validating → completed/failed/cancelled.
  Draft text is streamed live only; it is never persisted and is replaced by the validated result.
- **Cancellation:** `POST /requests/:id/cancel` stops the request between stages or aborts the provider call. Usage already incurred is recorded (outcome *Cancelled*).

## Reliability and rate limits

- **Deadlines:** set per use case.
- **Retries:** up to 3 attempts, for transient errors and short Retry-After waits only, with backoff and jitter.
- **Provider 429:** marks the connection **Rate Limited** until Retry-After.
- **Circuit breaker:** counts failures atomically; after 5 consecutive failures it pauses the connection for 2 minutes.
- **CRM-side limit:** requests per person per hour, from the policy.
- **Idempotency:** `Idempotency-Key` returns the earlier request.
- **Stale requests:** requests left running by a restart are closed by the worker.

## Usage ledger

Every provider call writes one append-only `AiUsageRecord`, including failed and cancelled calls. It records:

- organization, person, request, use case;
- provider, model, alias, mode;
- reported input, output and cached tokens;
- estimated cost with the price-table version, or **Cost unknown**;
- outcome, error category and duration.

**Who sees what:** people see their own usage; `ai_usage:view_organization` sees the whole organization.

## Cost estimation and price tables

- **Units:** versioned price tables per provider, per million tokens, with currency, effective date and a source note.
- **Defaults:** the platform tables are **estimates** from public pricing pages that an administrator must review. Anthropic has entries only for Haiku 4.5, so other Claude models show *Cost unknown*.
- **Overrides:** organizations can publish their own versioned table; earlier usage keeps the version it used.
- **Missing prices:** never counted as zero.

## Budgets and reservations

- **Scopes:** Organization, Use Case, User or Provider.
- **Periods:** daily or monthly.
- **Limits:** a soft limit (warning) and a hard limit (stop).
- **Reservations:** before a request, the worst-case estimated cost is **reserved** on every applicable budget under a per-budget database lock. If spent + held + reservation would exceed the hard limit, the request is refused before anything is sent.
- **Settlement:** after the call, the reservation is reconciled with the actual estimate. Failed calls release it, and stale reservations expire through the worker.
- **Soft limit:** records one warning per period (outbox notification `ai.budget.warning` plus audit).
- **Hard limit:** marks the budget exhausted; a Provider budget sets the connection to **Budget Exhausted** until the period resets or the limit is raised.
- **Unknown cost:** can't be checked against a limit. Such requests are allowed only while the hard limit isn't already reached, and are counted separately.

## Governed action proposals

**Allowed types** (`actions/actionTypes.js`):

| Action | Notes |
|---|---|
| Create follow-up | |
| Schedule meeting | No invitation is sent |
| Request missing information | Internal task |
| Add next action | |
| Update expected close date | |
| Assign owner | Approver by default |
| Create Deal | Approver by default |

**Flow:**

1. **Preview:** validates type, target, permission and inputs, and captures current values and record version.
2. **Confirm:** only the proposer, or someone with approval rights.
3. **Approve:** only a *different* person with `ai_actions:approve`, when policy or the type requires it.
4. **Execute:** runs through the **existing domain handlers**, the Activities and Deals controllers with their own scope rules, validation and audit.
5. **Record:** `AiActionExecution`, then audit.
6. **Undo:** where supported (cancel the created activity, restore the previous value or owner), within 24 hours.

**Safeguards:**

- Proposals expire after 24 hours.
- Record-version conflicts fail safely.
- A proposal is never shown as done until the handler confirms it.
- `POST /actions/suggest` asks the model for one action on a record. The model's tool call is schema-validated and becomes only a **preview**.

## Prohibited actions

These are always refused with an explanation of who is authorized and which manual workflow to use:

- delete, archive, merge;
- send email, SMS or chat;
- approve Quotes or discounts, confirm Orders, activate Contracts;
- post Invoices, process payments, refunds;
- change permissions, sign documents;
- export unrestricted data, HR decisions.

Every attempt is audited (`ai.action.prohibited_attempt`).

## Evaluations

- **Platform scenarios** (5 seeded) and organization scenarios.
- **Expectations:** required fields, forbidden patterns, numeric fidelity, expected refusal, citations, allowed action types.
- **Runs:** go through the normal gateway (policy, redaction, budgets and usage apply, attributed to `evaluation.run`) and store pass/fail/error with reasons.
- **Feedback:** stored for reviewers and **never retrains a model**.

## Existing AI features migrated

- `/ai/overview` narrative and explore now use the gateway, with organization policy, redaction, usage and budgets.
- The numeric guardrail and fail-closed deterministic fallback are kept.
- The provider picker lists only providers the organization can use.
- The frontend client (`src/pages/AI/aiGatewayClient.js`) uses the backend client in backend AI mode; response shapes are unchanged.

## Frontend AI Provider screens

`VITE_BACKEND_AI_MODE=true` (in `.env` and `.env.production`) makes the nine existing routes under `/admin/integrations/ai-providers/*` render backend-driven screens from `src/pages/Admin/aiBackend/`:

| Screen | What it does |
|---|---|
| Overview | Connections, usage estimate, budgets, **proposals awaiting approval** (approve/reject), recent audit |
| Providers | Connect with key, verify, rotate, disable/enable, remove |
| Models | Aliases per provider |
| Routing | Routing and limits per feature |
| Policies | The AI policy |
| Privacy | Redaction rules and context preview |
| Usage & Budgets | Usage, budgets and price tables |
| Evaluations | Run scenarios and see results |
| Audit | AI audit events |

Keys are typed into a password field, sent once, and never stored in the browser.

In the AI Overview, suggestions open a **governed action dialog**: prepare → review current vs proposed → confirm → approval when required → verified result and Undo.

With the flag off, the previous frontend previews are unchanged, and tests pin the flag off.

## RBAC and organization scope

New group **ai** with modules:

- `ai_providers`, `ai_models`, `ai_routing`, `ai_policies`;
- `ai_usage`, `ai_budgets`, `ai_features`, `ai_actions`;
- `ai_evaluations`, `ai_audit`.

It adds two new actions, `use` and `propose`.

| Role | AI access |
|---|---|
| System Owner, Organization Administrator | Everything |
| Department Manager | Use; propose, confirm and approve actions; view providers and models; own usage |
| Auditor / Checker | Read-only: policies, usage, budgets, evaluations, audit. Can't generate, configure or confirm |
| Standard Employee | Use; propose and confirm own actions; own usage |
| Finance Manager | Organization usage; manage budgets; use |
| Accountant | Use; own usage |

Every query is organization-scoped.

## Audit behavior

`ai.*` events cover:

- **Connections:** created, verified or verification failed, key rotated, disabled, enabled, deleted.
- **Configuration:** alias, routing, use case, policy, redaction and price-table changes.
- **Budgets:** created, changed, warning reached, hard stop.
- **Requests:** refused or cancelled, prompt-injection detections, output validation failures.
- **Actions:** proposed, confirmed, approved, rejected, cancelled, executed, failed, undone, prohibited attempt.
- **Evaluations** and **unsafe feedback.**

No keys, prompts containing restricted data, or provider bodies are recorded.

## Retention

Worker job `runAiMaintenance`, every 5 minutes:

- **Clears:** redacted request payloads after `requestPayloadDays`.
- **Deletes:** request events and provider request IDs after `providerMetadataDays`, evaluation results after `evaluationDays`, and feedback after `feedbackDays`.
- **Expires:** budget reservations and proposals.
- **Budget periods:** resets connections held by a provider budget from an earlier period.
- **Also:** closes stale requests and re-verifies live connections daily.
- **Kept:** usage records and audit.

## Tests executed

- **Server:** 472 tests in 57 files pass.
  - The 6 old AI gateway test files were removed with the old gateway.
  - New: `src/ai/adapters/adapters.test.js` (16) covers OpenAI, Anthropic and OpenRouter on stubbed transport (requests, parsing, streaming, errors, verification) and the simulator (behaviours, cancellation, no network).
  - New: `src/ai/gateway/governance.test.js` (16) covers redaction, injection, size limits, classification, policy and use-case validation, output schemas, action-claim detection, cost and periods, prohibited actions, evaluation scoring and error classification.
- **`npm run ai:test-simulator`:** 8/8, with no database, keys or network.
- **Frontend:** 1,535 existing tests pass, plus `GovernedActionDialog.test.jsx` (4).
- **Live checks** against the dev database (simulator mode):
  - 17/17 end-to-end: gateway, redaction, streaming, cancel, refusal, suggest → confirm → undo, prohibited, approval by a second person, version conflict, budget hard stop, policy off, RBAC, connection lifecycle, evaluations, audit.
  - Reliability set (retries, fallback, fallback refused by classification, circuit breaker, idempotency, per-user limit, soft-limit warning, organization prices, use-case switch, alias checks, context preview): all passed individually. The final combined rerun was interrupted by the dev SSH tunnel dropping.

## Lint and build results

- **Frontend lint:** all files changed in this phase lint clean. The repository still has the **36 lint problems that existed before** (unchanged count).
- **Server:** no ESLint setup; all `server/src/ai` files pass `node --check`.
- **Production build** (`npm run build`) succeeds; the only warning is the existing chunk-size notice.

## Deferred functionality

- **Real-provider verification** with an organization's OpenAI and Anthropic keys. Add them after deployment, from AI Providers → Providers.
- **Price review:** confirm the default price tables against current provider pricing; Claude models other than Haiku 4.5 show Cost unknown until priced.
- **Embeddings** are declared but unsupported (Phase 10 retrieval).
- **Phase 10:** Copilot conversations, memory, retrieval and workflows (`copilot.chat` is reserved and locked off).
- **More action targets:** governed actions on Contracts, Quotes and other modules. Only CRM Activities and Deals targets exist now.
- **Owner picker:** in the governed dialog it uses the CRM team list the frontend already has.
- **Explore records:** explore receives records from the browser the user already loaded; server-side record loading is a Phase 10 retrieval concern.
- **Document features:** anything involving documents waits for Phase 7.

## Configuration

| Variable | Purpose |
|---|---|
| `AI_MODE` | `live` or `simulator`. Default: simulator outside production, live in production; simulator refused in production |
| `INTEGRATIONS_KEYS` | The vault master key; AI keys use it too, and it's already required since Phase 8 |
| `AI_MAINTENANCE_INTERVAL_MS` | Worker AI maintenance interval (default 5 minutes) |
| `VITE_BACKEND_AI_MODE` | Frontend: backend-driven AI screens and governed actions |

Commands: `npm run db:seed:ai`, `npm run ai:test-simulator`, `npm run test:ai`, `npm run integrations:verify-encryption`.
