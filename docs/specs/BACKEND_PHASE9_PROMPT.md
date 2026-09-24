Continue from the current repository after completing Backend Phases 1–8.

Backend Phase 7 (Documents, Object Storage, File Security and Electronic Signatures) was skipped. Anything in this phase that depends on Documents must report "Requires Phase 7" instead of inventing results.

Implement:

Backend Phase 9 — AI Gateway, Provider Billing, OpenAI/Claude Integration and Governed AI Actions

This phase turns the existing early AI gateway (`server/src/services/ai/`, `/api/v1/ai/providers`, `/api/v1/ai/narrative`, `/api/v1/ai/explore`) and the fixture-only AI Provider screens (`/admin/integrations/ai-providers/*`) into a secure, provider-neutral, organization-governed AI platform.

Continue using PostgreSQL, Redis, the background worker, authentication, RBAC, audit logging, the Phase 8 encrypted credential vault, the Phase 8 provider-simulator pattern and the API conventions established in earlier phases.

Phase 10 (AI Copilot) will build on this phase. Build these foundations so Phase 10 can reuse them without redesign:

- Provider-neutral AI gateway
- Provider policies
- Usage and budget ledger with budget reservations
- Governed action system
- Evaluations
- AI provider simulator

Critical connection boundary

Do not claim an AI provider is connected merely because its card exists.

Use explicit AI provider connection states:

- Not Configured
- Configuration Incomplete
- Ready to Verify
- Connected
- Connected with Warnings
- Verification Failed
- Rate Limited
- Budget Exhausted
- Suspended by Policy
- Disabled
- Revoked
- Error

An AI provider is Connected only after the backend has:

1. Stored the API key encrypted in the vault.
2. Called an authenticated provider endpoint (for example, a models list or a minimal request).
3. Confirmed at least one approved model is available to that key.
4. Recorded the verification date and the verified model list.

Phase 9 scope

Implement:

- Provider-neutral AI gateway
- AI provider catalog
- Organization AI provider connections (organization-owned keys)
- OpenAI adapter
- Anthropic (Claude) adapter
- Existing OpenRouter adapter kept behind the same contract, disabled by default
- Deterministic AI provider simulator
- Model catalog and model aliases
- AI use cases
- Routing policies
- AI policies
- Data classification and redaction
- Context assembly with size limits
- Prompt templates with versions
- Structured output validation
- Streaming (server-sent events)
- Cancellation
- Timeouts, retries and circuit breaker
- Provider rate-limit handling
- Usage ledger
- Cost estimation with versioned price tables
- Budgets, budget reservations and hard stops
- Provider billing visibility (the organization pays the provider directly)
- Governed AI action proposals
- Action preview, confirmation, approval, execution through domain services, and undo
- Prohibited-action enforcement
- Evaluation scenarios and evaluation runs
- AI audit log
- Retention and deletion
- Migrating `/ai/overview` narrative and explore to the new gateway
- Frontend AI Provider screens in backend mode

Strict phase boundary

Do not implement:

- AI Copilot conversations (Phase 10)
- Conversation memory (Phase 10)
- Vector indexing or semantic retrieval (Phase 10)
- Copilot tools or workflows (Phase 10)
- The `/ai/copilot` backend (Phase 10)
- Document ingestion (Phase 7 was skipped)
- Model fine-tuning or training on CRM data
- Automatic use of feedback to retrain any model
- Provider-managed conversation storage enabled by default
- Provider-side memory features enabled by default
- Autonomous agents or background AI goals
- Model-generated SQL or direct database access by a model
- Automatic sending of email, SMS or chat messages
- Automatic approval of Quotes or discounts
- Automatic Order confirmation
- Automatic Contract activation
- Automatic Invoice posting
- Automatic payment or refund initiation
- Automatic permission changes
- Automatic deletion, archiving or merging of records
- Collecting card details or charging customers for AI usage
- Reselling provider usage
- Storing provider keys in the browser, in frontend code or in plaintext in PostgreSQL
- Sending restricted fields to any provider
- Hidden chain-of-thought storage
- Browsing the public web
- Executing code or shell commands

Do not redesign the completed AI Provider screens. Connect them to the backend.

Provider billing model

The organization brings its own provider account and key and pays the provider directly.

The CRM:

- Records provider-reported usage (input tokens, output tokens, cached tokens where reported, requests)
- Estimates cost from a versioned price table that administrators can review
- Shows estimated cost labeled "Estimated — not a provider invoice"
- Enforces the organization's budgets
- Never charges, invoices or collects payment for AI usage

Price tables must record currency, unit, effective date and source note.

Do not hard-code prices in business logic.

A missing price must show "Cost unknown", never zero.

Providers

AI provider catalog entries:

- OpenAI — adapter
- Anthropic (Claude) — adapter
- OpenRouter — adapter, disabled by default
- Google Gemini — catalog only
- Azure OpenAI — catalog only
- Ollama (self-hosted) — catalog only
- AI Provider Simulator — always available outside production and clearly labeled "AI Provider Simulator — no external AI provider is connected."

Each catalog entry records:

- Key, name and description
- Authentication type
- Supported capabilities (text generation, structured output, tool calling, streaming, embeddings)
- Data-retention notes and link to the provider's official data-usage policy
- Availability (Adapter, Catalog Only, Disabled)
- Adapter version

OpenAI adapter

- Use the official OpenAI API as currently documented (Responses API preferred where appropriate).
- Request provider-side storage off (for example `store: false`) by default.
- Support structured outputs, tool/function-call requests, streaming and cancellation.
- Normalize usage from the provider's reported fields.

Anthropic adapter

- Use the official Anthropic Messages API as currently documented.
- Support structured output through tool schemas, tool-use requests, streaming and cancellation.
- Keep provider-side features such as memory tools disabled unless organization policy explicitly enables them.
- Normalize usage from the provider's reported fields.

Do not hard-code specific model names in business logic. Models come from the model catalog.

Adapter contract

Every adapter must implement a single provider-neutral contract:

- verifyCredentials
- listModels
- generate
- generateStructured
- stream
- cancel
- requestToolCall (returns requested calls; the gateway never executes them inside the adapter)
- embed (declared; may be "unsupported" in this phase)
- normalizeUsage
- normalizeError
- getRateLimitState

Unsupported operations must return an explicit unsupported result, never a silent no-op.

Models

Add:

- ai_providers
- ai_provider_connections
- ai_provider_credentials (or reuse the Phase 8 credential store with an AI credential type)
- ai_models
- ai_model_aliases
- ai_price_tables
- ai_price_entries
- ai_use_cases
- ai_routing_policies
- ai_policies
- ai_redaction_rules
- ai_prompt_templates
- ai_prompt_template_versions
- ai_requests
- ai_request_events
- ai_usage_records
- ai_budgets
- ai_budget_reservations
- ai_action_proposals
- ai_action_approvals
- ai_action_executions
- ai_evaluation_scenarios
- ai_evaluation_runs
- ai_evaluation_results
- ai_feedback

Every tenant-owned record must include an organization boundary.

Index:

- Organization and created date
- Organization, user and use case
- Provider request ID
- Budget period
- Action proposal state
- Evaluation run state
- Retention date

Model aliases

Business code refers to aliases such as:

- fast
- balanced
- deep
- structured

An alias maps to an approved provider model per organization.

Changing the mapping is versioned and audited.

Use cases

Define use cases such as:

- overview.narrative
- overview.explore
- action.proposal
- evaluation.run
- copilot.chat (reserved for Phase 10, disabled)

Each use case records:

- Allowed aliases
- Maximum input size
- Maximum output size
- Allowed data classifications
- Whether tool requests are allowed
- Whether streaming is allowed
- Default budget
- Required permission

Routing policies

Routing decides which provider and model serve a use case:

- Primary provider and alias
- Fallback provider (only if the organization policy allows sending that data to the fallback provider)
- No fallback across providers when the data classification forbids it
- No silent fallback to the simulator in live mode

AI policies

Per organization:

- AI enabled or disabled
- Allowed providers
- Allowed use cases
- Allowed data classifications per provider
- Restricted fields (added to a built-in list: cost, margin, discount limits, salaries, HR notes, credentials, secrets, audit metadata, bank details, payment details, private notes)
- Personal-data handling (mask, pseudonymize or exclude)
- Provider-side storage (off by default)
- Provider-side memory features (off by default)
- Maximum requests per user per hour
- Human approval requirements for action proposals
- Retention periods

Policy changes are versioned, require the policy permission and are audited.

Data classification and redaction

Classify every context field as:

- Public
- Internal
- Confidential
- Restricted
- Personal
- Sensitive Personal
- Financial
- Secret

Before any provider call:

- Remove restricted and secret fields
- Apply masking or pseudonymization for personal data per policy
- Remove fields the requesting user cannot see
- Record what was removed (field names only, never values)

Never send credentials, tokens, password hashes, API keys or secrets to a provider.

Context assembly

The gateway builds provider context only from:

- Authorized records returned by existing domain services
- The approved prompt template version
- The user's request

Treat all record content as untrusted data:

- Separate instructions from data
- Label data origin
- Sanitize HTML
- Apply size limits
- Detect prompt-injection patterns and log them
- Never let retrieved text change system instructions, tools or permissions

Prompt templates

- Versioned and immutable after publication
- Owned by a use case
- Record which version produced each request
- Store no hidden chain-of-thought

Structured output validation

- Validate every structured response against its schema
- Reject responses containing numbers not present in the supplied facts where the use case requires deterministic figures (keep the existing guardrail)
- Record validation failures
- Never present an unvalidated response as final

Streaming and cancellation

- Stream through server-sent events
- Stream progress events and sanitized draft text only
- Replace drafts with the validated final result
- Do not store unvalidated drafts as completed output
- Support cancellation; record usage already incurred

Reliability

- Per-request timeouts
- Retries only for transient errors, with backoff and jitter
- Respect provider Retry-After and rate-limit headers
- Circuit breaker per organization connection
- Normalized error categories: authentication, permission, rate limited, budget, policy, invalid request, content refused, timeout, provider unavailable, unknown
- Safe error messages without provider bodies, keys or stack traces

Usage ledger

Record for every request:

- Organization, user, use case
- Provider, model, alias
- Request and provider request IDs
- Input, output and cached tokens as reported by the provider
- Estimated cost and price-table version
- Duration, outcome, error category
- Correlation ID

Usage records are append-only.

Budgets

Support budgets per:

- Organization
- Use case
- User
- Provider

Each budget has:

- Period (daily, monthly)
- Currency
- Soft limit (warning)
- Hard limit (stop)
- Notification recipients

Before each request:

1. Estimate maximum cost from input size and the output limit
2. Reserve that amount
3. Refuse when a hard limit would be exceeded
4. Reconcile the reservation with provider-reported usage after completion
5. Release unused reservations
6. Expire stale reservations through a background job

Budget exhaustion changes the connection or use case state to "Budget Exhausted" until the period resets or an administrator raises the limit.

Governed AI actions

Build the reusable action-proposal system Phase 10 will use.

Flow:

1. A model output (or a user) proposes an allowed action type
2. The backend validates the action type, target, permissions, record version and inputs
3. The user sees a preview: action type, reason, affected record, current values, proposed values, supporting evidence, required permission, required approver, impact and expiration
4. The user confirms
5. An approver reviews when policy requires it
6. The existing domain service executes the change
7. An audit event is recorded
8. The verified result is reported
9. Safe undo is offered when the domain supports it

Allowed action types in this phase:

- Create follow-up Activity
- Schedule meeting (creates an Activity; sends no invitation)
- Assign owner
- Update expected close date
- Add next action
- Create Deal
- Request missing information (creates a task; sends nothing externally)

Action proposals must:

- Expire
- Detect record-version conflicts at execution
- Never execute from a model call alone
- Never be shown as completed before the domain service confirms

Prohibited actions (always rejected, with an explanation of who is authorized and which manual workflow to use):

- Delete
- Archive
- Merge
- Send email, SMS or chat messages
- Approve Quotes or discounts
- Confirm Orders
- Activate Contracts
- Post Invoices
- Process payments or refunds
- Change permissions
- Sign documents
- Export unrestricted datasets
- HR disciplinary decisions

Evaluations

- Evaluation scenarios per use case with expected properties (required fields, forbidden content, numeric fidelity, refusal expected, citation expected)
- Evaluation runs against a chosen provider and alias, or the simulator
- Results stored per scenario with pass, fail and reason
- Runs consume budget and are recorded in usage
- Feedback may be attached to scenarios by an authorized reviewer
- Nothing automatically retrains a provider model

AI provider simulator

Deterministic and credential-free. It must support:

- Verification and models list
- Text generation
- Structured output
- Tool-call requests
- Streaming
- Cancellation
- Refusal
- Timeout
- Rate limiting with Retry-After
- Authentication failure
- Invalid structured output
- Prompt-injection test inputs
- Reported usage figures

It must be clearly labeled, available only outside production, and never mixed with a live connection.

Default tests and local development must work without real OpenAI or Anthropic keys and must make no external requests.

Existing AI features

Route `/ai/overview` narrative and explore through the new gateway:

- Organization policy and redaction apply
- Usage and budgets apply
- The existing numeric guardrail stays
- The provider-selection header remains for authorized users, restricted to connected providers

Keep existing behavior when the gateway is unavailable: show a clear unavailable state, never fabricated output.

Frontend

Connect these existing screens to the backend behind a new flag `VITE_BACKEND_AI_MODE`:

- AI Provider overview
- Provider connections (connect with key, verify, disable, rotate key)
- Model catalog and aliases
- Routing policies
- AI policies
- Privacy and redaction (with a context-assembly preview showing what would be sent and what was removed)
- Usage and budgets
- Evaluations
- AI audit log
- Action proposal preview and confirmation dialogs

API keys are entered once, sent to the backend, never displayed again and never stored in the browser.

Show the simulator label wherever simulator data appears.

Do not silently fall back to fixture data in backend mode.

Permissions

Add permissions equivalent to:

- ai.providers.view
- ai.providers.manage
- ai.credentials.rotate
- ai.models.view
- ai.models.manage
- ai.routing.manage
- ai.policies.view
- ai.policies.manage
- ai.usage.view
- ai.usage.view.organization
- ai.budgets.manage
- ai.use
- ai.actions.propose
- ai.actions.confirm
- ai.actions.approve
- ai.evaluations.view
- ai.evaluations.run
- ai.audit.view

Role expectations:

- System Owner: platform provider catalog, simulator availability, platform-safe metrics; no automatic access to tenant AI data
- Organization Administrator: organization connections, keys, policies, routing, budgets, usage, evaluations
- Finance Manager: usage and budgets
- Department and Sales Managers: use AI features within their scope; confirm action proposals within their scope
- Standard users: use AI features on records they can access; confirm their own action proposals
- Auditor / Checker: read-only usage, policies, evaluations and audit; cannot confirm actions

APIs

Add versioned endpoints equivalent to:

Providers and connections

- GET /api/v1/ai/providers
- GET /api/v1/ai/providers/{key}
- GET /api/v1/ai/connections
- POST /api/v1/ai/connections
- GET /api/v1/ai/connections/{id}
- PATCH /api/v1/ai/connections/{id}
- POST /api/v1/ai/connections/{id}/verify
- POST /api/v1/ai/connections/{id}/rotate-key
- POST /api/v1/ai/connections/{id}/disable
- POST /api/v1/ai/connections/{id}/enable
- DELETE /api/v1/ai/connections/{id}

Models, use cases and routing

- GET /api/v1/ai/models
- GET /api/v1/ai/model-aliases
- PUT /api/v1/ai/model-aliases/{alias}
- GET /api/v1/ai/use-cases
- PATCH /api/v1/ai/use-cases/{key}
- GET /api/v1/ai/routing-policies
- PUT /api/v1/ai/routing-policies/{useCase}

Policies and privacy

- GET /api/v1/ai/policy
- PATCH /api/v1/ai/policy
- GET /api/v1/ai/redaction-rules
- PUT /api/v1/ai/redaction-rules
- POST /api/v1/ai/context-preview

Generation

- POST /api/v1/ai/narrative (existing, migrated)
- POST /api/v1/ai/explore (existing, migrated)
- GET /api/v1/ai/requests/{id}/events (server-sent events)
- POST /api/v1/ai/requests/{id}/cancel

Usage, pricing and budgets

- GET /api/v1/ai/usage
- GET /api/v1/ai/usage/summary
- GET /api/v1/ai/price-tables
- PUT /api/v1/ai/price-tables/{provider}
- GET /api/v1/ai/budgets
- POST /api/v1/ai/budgets
- PATCH /api/v1/ai/budgets/{id}

Governed actions

- GET /api/v1/ai/actions
- POST /api/v1/ai/actions/preview
- GET /api/v1/ai/actions/{id}
- POST /api/v1/ai/actions/{id}/confirm
- POST /api/v1/ai/actions/{id}/approve
- POST /api/v1/ai/actions/{id}/reject
- POST /api/v1/ai/actions/{id}/cancel
- POST /api/v1/ai/actions/{id}/undo

Evaluations and audit

- GET /api/v1/ai/evaluations/scenarios
- POST /api/v1/ai/evaluations/scenarios
- POST /api/v1/ai/evaluations/runs
- GET /api/v1/ai/evaluations/runs/{id}
- POST /api/v1/ai/feedback
- GET /api/v1/ai/audit

Simulator

- /api/v1/ai/simulator/* only in simulator mode outside production

Use existing conventions for errors, pagination, filtering, idempotency keys, CSRF and correlation IDs.

No endpoint may return a decrypted API key.

Audit

Record audit events for:

- Connection created, verified, verification failed, disabled, enabled, deleted
- Key rotation
- Alias, routing, policy, redaction and price-table changes
- Budget created, changed, warning reached, hard stop
- Requests refused by policy or budget
- Prompt-injection detections
- Structured-output validation failures
- Action proposal created, confirmed, approved, rejected, cancelled, executed, failed, undone
- Prohibited-action attempts
- Evaluation runs
- Unauthorized access attempts

Audit events never contain API keys, full prompts with restricted data, or provider response bodies.

Retention

Define retention for:

- Request payload snapshots (redacted)
- Draft stream content
- Usage records (kept; aggregated after retention)
- Action proposals and executions (audit metadata kept)
- Evaluation results
- Feedback
- Provider request metadata

Background jobs:

- Expire stale budget reservations
- Expire action proposals
- Apply retention
- Reset budget periods
- Periodically re-verify connections

Commands

Document and provide:

- Seeding the AI provider catalog, models, aliases, use cases and prompt templates
- Seeding the default price table (clearly marked as an estimate requiring review)
- Verifying AI credential encryption
- Running the AI provider simulator
- Running AI tests

Required tests

Add tests for at least:

- Provider catalog seed idempotency
- Connection states
- Connected only after verification
- API key encrypted at rest
- API key never returned
- Key rotation
- OpenAI adapter request and usage normalization (stubbed transport)
- Anthropic adapter request and usage normalization (stubbed transport)
- Adapter error normalization
- Simulator: generation, structured output, tool request, streaming, refusal, timeout, rate limit, authentication failure
- No external request in default tests
- Alias resolution
- Routing and permitted fallback
- No fallback across forbidden data classifications
- Policy disables AI
- Policy restricts providers and use cases
- Restricted-field removal before provider calls
- Personal-data masking
- Field visibility per user
- Context size limits
- Prompt-injection inertness
- HTML sanitization
- Structured-output validation failure
- Numeric guardrail
- Streaming events
- Draft not stored as final
- Cancellation records usage
- Timeout and retry
- Circuit breaker
- Usage ledger record
- Cost estimation with price table version
- Unknown price shown as unknown
- Budget reservation
- Reservation reconciliation
- Reservation expiry
- Soft-limit warning
- Hard-limit stop
- Action proposal preview
- Action confirmation required
- Approver required by policy
- Record-version conflict
- Execution through domain service
- Undo
- Prohibited-action rejection
- Proposal expiry
- Evaluation scenario run
- Evaluation consumes budget
- Feedback does not retrain
- Organization isolation for every AI table
- RBAC for every endpoint
- Auditor read-only
- Overview narrative and explore through the gateway
- Frontend AI Provider screens in backend mode
- Existing frontend and backend regression tests

Definition of done

Backend Phase 9 is complete only when:

- The AI provider catalog persists in PostgreSQL
- AI connections are organization-scoped
- API keys are encrypted at rest and never returned
- A provider shows Connected only after verification
- OpenAI and Anthropic adapters share one provider-neutral contract
- The simulator works without real keys
- Simulator mode is clearly distinguished from live mode
- Aliases, use cases and routing are configurable and audited
- AI policies control providers, use cases and data classifications
- Restricted fields never reach a provider
- Prompt-injection content stays inert
- Structured outputs are validated
- Usage is recorded for every request
- Estimated costs use versioned price tables and are labeled as estimates
- Budgets reserve before requests and stop at hard limits
- Action proposals require preview and human confirmation
- Approved actions execute only through existing domain services
- Prohibited actions cannot execute
- Evaluations run and are recorded
- `/ai/overview` uses the gateway
- AI Provider screens work in backend mode
- Automated tests make no real provider requests
- Migrations pass
- Tests pass
- Lint passes
- Production build passes
- Phase 1–8 tests remain passing

Final report

Provide only the Backend Phase 9 report:

- Routes connected
- Database models and migrations
- AI provider catalog
- Adapter architecture
- OpenAI adapter
- Anthropic adapter
- AI provider simulator
- Connection verification
- Credential encryption
- Models, aliases and routing
- AI policies
- Data classification and redaction
- Context assembly and prompt-injection protection
- Structured output validation
- Streaming and cancellation
- Reliability and rate limits
- Usage ledger
- Cost estimation and price tables
- Budgets and reservations
- Governed action proposals
- Prohibited actions
- Evaluations
- Existing AI features migrated
- Frontend AI Provider screens
- RBAC and organization scope
- Audit behavior
- Retention
- Tests executed
- Lint and build results
- Deferred functionality

Do not claim OpenAI or Claude is connected unless backend verification succeeded with a real key.

Do not claim costs are provider charges.

Do not claim any action was executed unless the domain service confirmed it.

After completing this phase, stop and wait for approval before starting:

Backend Phase 10 — AI Copilot, Conversation Memory, Permission-Aware Retrieval and Governed Workflows
