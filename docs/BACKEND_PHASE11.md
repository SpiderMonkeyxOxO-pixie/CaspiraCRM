# Backend Phase 11 — AI Governance, Safety Operations, Evaluation Management and Production Rollout

**Pilot-readiness status.** This phase is ready for an **explicitly authorized pilot**:
- the controls are in place and verified in simulator mode against the development database;
- a pilot still needs an organization to opt in through an approved release, and every mandatory readiness item recorded.

**What this is not:**
- **General availability is not approved.** Production-readiness items that need people remain incomplete: provider agreements, backups, restore tests, support process.
- **Nothing is deployed.** Deployment is deferred until all backend phases are finished.
- **No live AI provider is connected.** No live OpenAI or Anthropic connection has been verified.
- **No compliance is certified.** Controls existing is not a regulatory or legal certification, and no Zero Data Retention is claimed.
- **Safety incidents remain possible.** The controls reduce and contain risk; they don't make incidents impossible.
- **The CRM backend is not complete.** Backend Phase 7 (Documents) has not been built.

## Governance routes

The frontend **AI Administration** menu shows only the pages the member's grants open, driven by `GET /api/v1/ai/governance/access`. It is hidden from ordinary employees and never shown to portal users (who have no membership, so the endpoint returns 404).

| Route | Page | Opens with |
|---|---|---|
| `/ai/governance` | Overview, Capabilities (with readiness), Policies, Registry (providers, models, prompts, tools, workflows), Kill switches, Flags, Exceptions, Review queue, Reports | `ai_governance:read` |
| `/ai/evaluations` | Runs, gates, cases, human review, comparisons, suites and graders, datasets | `ai_gov_evaluations:read` |
| `/ai/monitoring` | Metrics, filters, SLOs, alerts, safety events, privacy, service health | `ai_monitoring:read` or `ai_safety:review` |
| `/ai/incidents` | Incidents, timeline, containment, evidence, regression cases, restoration | `ai_incidents:view` |
| `/ai/releases` | Manifests, gates, approvals, cohorts, promote, pause, rollback, retire | `ai_governance:read` |
| `/ai/usage` | Cost governance, allocation, invoices | `ai_usage_governance:read` |

Each page also checks access itself; without the grant, the member sees a permission message.

**API.** All endpoints are under `/api/v1/ai/`: `governance/*`, `evaluations/*`, `releases/*`, `monitoring/*`, `incidents/*`, `kill-switches/*` and `reviews/*`. Details are in `server/src/routes/aiRoutes.js`.

**Moved route.** Phase 9's quick scenario checks moved from `/evaluations/runs` to `/evaluations/scenario-runs`, because the governed suite runs now use `/evaluations/runs`.

## Capability registry and risk classification

Thirteen capabilities are registered, each with owners (business, technical, risk), purpose, roles, modules, data classifications, providers, models, prompt/tool/workflow versions, approvals, evaluation suite, retention, budget, status, review date and sunset date:
- AI Intelligence Overview and AI Copilot;
- the six Copilot workflows;
- suggested-action proposals, semantic retrieval and durable user memory;
- provider-managed conversation state and provider-hosted retrieval. These two are **Not configured**: the CRM does neither.

**Risk rules.** Risk (Low, Moderate, High) sets the number of independent approvals, whether a safety reviewer is required, evaluation depth, maximum canary size, monitoring frequency, default incident severity and retention.

**Prohibited automation.** A capability can't be registered as Prohibited, or with any prohibited automation: delete, archive, merge, send, approve quotes, confirm orders, activate contracts, payments or refunds, permissions, signing, restricted publishing, HR decisions, disabling security, or modifying AI governance.

**Changes.** Capability changes are made by a System Owner, and every change creates an immutable `AiCapabilityVersion`.

## Policy lifecycle

**States:** Draft → Submitted / Under review → Changes requested → Approved → Active; also Paused, Superseded and Retired.

**Immutable versions.** Every change is a new, checksummed version; versions are never edited.

**Separation of duties.** For moderate and high risk, the author can't approve their own policy, and an attempt is recorded as a safety event. High risk also needs a safety reviewer's approval.

**Activation prerequisites.** A version activates only when all of these hold:
- a passing evaluation of the capability's suite within 30 days;
- verified providers;
- retention configured;
- a budget;
- active monitoring (alert rules);
- a rollback target.

Otherwise the version stays Approved and the unmet items are listed.

**Pausing.** Pausing a capability's policy stops that capability for the organization. Resuming restores its active version.

## Provider, model, prompt, tool and workflow governance

- **Providers.** One platform record per provider; an organization gets its own copy when it records its own contract details.
  - Contract, DPA, residency, retention and zero-retention fields stay **Unverified**. An administrator can confirm one only with a written note, and who confirmed it and when are recorded.
  - Verification uses the Phase 9 connection check.
  - Suspended or policy-blocked providers are refused at runtime.
- **Models.**
  - Moving aliases (e.g. undated OpenAI ids) are flagged, and a release can't pin one.
  - Approving a model needs a passing evaluation with it as the candidate, a comparison against the current model, and someone other than whoever last configured it.
  - Blocked or retired models are refused at runtime. Nothing migrates automatically.
- **Prompts.** The gateway uses the **Active** governed version (or a release-pinned version), never "latest published".
  - New versions are Drafts.
  - System instructions may not contain placeholders, and data placeholders must sit inside `<data>`.
  - Moving to review or approval needs a passing evaluation run with that version as candidate.
  - The author can't approve or publish their own version.
  - Publishing checks the stored checksum, marks the template version Published (immutable) and supersedes the previous one.
- **Tools.** Deny by default: the model only sees tools whose governed version is **Active**; others are withheld and reported.
  - Activation needs code with a schema, a passing authorization, isolation, sensitive-data and injection suite within 30 days, and an approval by someone other than the activator.
  - The Phase 10 tools were seeded Active as the evaluated baseline.
- **Workflows.** Only the Active version whose steps checksum matches the code runs.
  - Changed code registers as a new Draft version, which isn't runnable until approved and activated.
  - The model can't add steps; the Phase 10 limits still apply.

## Evaluation architecture, datasets and graders

**Application-owned.** The system has no dependency on any provider evaluation service.

**What a run is.** A run executes every case of a versioned suite against a candidate configuration (provider, model, prompt, tool and workflow versions, retrieval).

**Case kinds:**
- **deterministic:** code only.
- **gateway:** a synthetic `runAi` call.
- **copilot:** a real Copilot turn as a member with the case's role, in the run's organization.

In production, Copilot and gateway cases only run from an authorized, redacted production dataset. Evaluation traffic is labelled `evaluation:*`, excluded from misuse counts, monitoring and alerts, and never escalated.

**Seeded datasets (28 cases):**

| Dataset | Covers |
|---|---|
| `zero_tolerance_core` | every zero-tolerance category |
| `prompt_injection` | direct, indirect, tool-result, encoded, moderation, gateway |
| `citations_quality` | citation behaviour |
| `overview_gateway` | AI Overview gateway calls |
| `memory_and_proposals` | memory and suggested-action proposals |
| `incident_regressions` | cases created from incidents; always runs its latest version |

**Seeded suites:**
- `ai_copilot_release`: quality gates on citation precision and coverage, deterministic accuracy, unsupported-claim rate, p95 latency (warn) and cost per success (warn).
- `ai_overview_release`.
- `zero_tolerance_quick`, used for restoration.

**Dataset rules:**
- Datasets are versioned and immutable.
- Production-derived datasets need an authorizer (not the requester) with evaluation review permission, a purpose, a retention period of at most 365 days, and redaction of credentials, emails and phone numbers.
- Datasets are deleted on request or when their retention ends.
- Conversations are never copied into datasets automatically.

**Graders:**
- **Authoritative:** code, schema, authorization, evidence, citation and human.
  - The authorization grader re-reads every cited record as the evaluating user, and checks identity-field stripping, denied tools, executions, proposal status and memory.
- **LLM quality grader:** scores only relevance, usefulness, clarity, tone, explanation and completeness.
  - Isolated `evaluation.grade` prompt, structured output, redacted input.
  - Skipped if it would judge its own candidate model.
  - Stores the verdict only; disagreements with authoritative graders are shown.
  - Marked **Uncalibrated** and never counts toward a gate.

**Run states:**
- Draft, Queued, Running, Awaiting human review, Passed, Passed with warnings, Failed, Cancelled, Invalid, Superseded.
- A run with errored or missing cases is **Invalid**, never Passed.
- The prompt author can't review cases of a run that tests their prompt.

**Comparisons.** Comparisons of two completed runs of the same suite show accuracy, citations, unsupported claims, latency, cost and grader disagreement side by side. Cost alone never justifies a choice.

## Release gates

| Gate | Rule |
|---|---|
| Zero tolerance | Any failure in a case tagged cross-tenant leakage, unauthorized record, credential leakage, authentication/authorization bypass, restricted-field leakage, prohibited action, action without approval, fabricated execution or autonomous destructive behaviour blocks the release. No exception can waive it. |
| Quality | Configurable thresholds, each stored with method, dataset versions, sample size, result and level (block or warn). "Insufficient data" blocks. |
| Independent approval | Per risk level (see Release management). |
| Production readiness | A checklist of 24 items, machine- and human-readable; automatic items are computed from evidence, manual items need recorded evidence. General availability is blocked until every mandatory item is complete. |

## Safety controls, moderation and prompt-injection protection

**Layers:**
- **Input:** authentication, rate limits, repeated-misuse limiting (5 Medium+ events per hour pause AI for that member), moderation.
- **Context:** the Phase 9/10 authorization, redaction and `<data>` isolation.
- **Tools:** allowlist, governance activation, kill switch, schemas and grants. Identity fields naming another organization are stripped and recorded as a cross-tenant attempt. Tool results with instruction-like content are flagged.
- **Output:** schema and citation validation; credential, key, token, password and card scanning with redaction.
- **Execution:** proposals only; the execution kill switch; separation-of-duties checks that record approval-bypass attempts.

**Moderation adapter:**
- **Modes:** `local` (the default: rules plus injection detection, including base64-encoded instructions), `openai` (only when configured and not in simulator mode), or `disabled`.
- **What it checks:** user-typed text only; system-generated data is not moderated.
- **What it records:** category, policy version, decision, confidence, provider, model, time and correlation ID. The input text itself is never stored.
- **Decisions:** Refuse and Require human review stop the request with a safe message.

**Safety identifier.** An HMAC of organization and user with `AI_SAFETY_ID_SECRET`, versioned by `AI_SAFETY_ID_VERSION`. It is sent as OpenAI `safety_identifier` or Anthropic `metadata.user_id`, never a name, email or raw id, and its version is recorded on each request. In simulator mode only, a development secret is used.

## Safety events

**Normalized categories** include injection, sensitive data, restricted retrieval, invalid citation, unauthorized tool, prohibited action, approval bypass, provider refusal, moderation block, repeated probing, cross-tenant attempt, credential exposure and kill switch.

**Summaries** are written by code, never copied from user input.

**By severity:**
- **High and Critical** notify responders.
- **Critical** also opens an incident, preserves evidence and blocks promotion. When configured (`AI_CRITICAL_AUTO_PAUSE`), it also pauses the capability for the organization.

## Kill switches

**Kinds:** global, provider, model, capability, tool, workflow, organization, semantic retrieval, provider storage and governed-action execution. There are 75 platform switches, and organization copies are created on first use.

**How they work:**
- They're checked server-side on every AI path, including a re-check just before the provider call.
- Propagation: immediate in the acting process, and within `AI_GOVERNANCE_CACHE_MS` (default 2 s) elsewhere; the measured value is recorded.
- They need permission and a written reason, and are audited and notified.
- New work stops. Queued requests, Copilot messages, workflow runs, evaluations and indexing jobs are cancelled; active work is handled per the switch's policy.
- Global and platform switches are for a System Owner only.
- A switch used to contain an incident can't be turned off until restoration is approved.

## Incident management

**States:** Detected → Triage → Contained → Investigating → Remediating → Monitoring → Resolved → Closed (and Reopened). Severity runs from SEV-0 to SEV-4.

**Workflow:**
- Containment activates kill switches or pauses releases.
- SEV-0 to SEV-2 incidents block promotion of the capability's releases.
- Regression cases are added as new versions of the incident dataset.
- **Restoration** needs a passing run that includes every regression case, approved by someone other than the incident owner.
- A contained incident can't be resolved before restoration; resolving needs a root cause.
- Closing lifts the promotion block if no other serious incident is open.

**Evidence:**
- redacted (keys, tokens and credential-like values removed) and hashed;
- time-limited (`AI_INCIDENT_EVIDENCE_DAYS`, default 90);
- read only with `ai_incidents:read_evidence`, and every read is audited.

## Monitoring and SLOs

**Metrics** (safe aggregates only: no prompts, no record labels):
- **Volume and reliability:** volume, active users, availability, error/refusal/validation rates, structured-output validity, p50/p95 and first-progress latency.
- **Copilot quality:** citation failures, low confidence, tool outcomes, index lag, proposal outcomes.
- **Safety and cost:** safety events, incidents, tokens, estimated cost, and breakdowns by provider, model, capability, release, prompt version and billing source.
- **Privacy:** storage mode, provider-hosted inventory (none), requests by provider, redactions, payloads awaiting deletion, production datasets, retrieval sources.

**Filters:** window, organization, provider, model, capability, release, member and severity. Department and team filters are not available, because there is no department or team model.

**SLOs:** 13 objectives, each with a measurement window. The worker measures them every 15 minutes (or on demand), recording value, sample size and Met / Missed / **Insufficient data**. Nothing is reported as met without data.

## Alerts

**Rules (16):**
- provider: outage, credential failure, rate-limit surge;
- cost: budget threshold, cost anomaly (≥ 3× the trailing 7-day hourly baseline);
- quality and safety spikes: validation failure, citation failure, retrieval failure, safety events;
- attacks: cross-tenant attempt, approval-bypass attempt;
- change: evaluation regression, model deprecation, prompt/release failure;
- capacity: queue backlog, index staleness.

**Handling:**
- deduplication (one open alert per rule);
- cooldown, escalation after a delay, acknowledgement and resolution;
- automatic resolution when the condition clears;
- suppression windows and audit.

Notifications go through the existing outbox.

## Release management, staged rollout and rollback

**The manifest pins everything a release runs with:**
- provider and pinned model (with settings);
- prompt versions, output schema and selector versions;
- retrieval, tools and workflows;
- policy version, evaluation suite, budget, retention and flags.

It is validated against governance and checksummed. A live release's manifest drives routing, model and prompt version for its cohort.

**Separation of duties:**
- The author and the authors of the included prompts can't approve.
- Moderate risk needs 1 independent approval; High needs 2 plus a safety reviewer.
- An emergency override needs System Owner review.

**Stages:**

| Stage | Rules |
|---|---|
| Shadow | needs data-policy and budget authorization; output is discarded and accounted separately |
| Internal pilot, organization pilot | needs a cohort; organization pilot needs an Organization Administrator |
| Canary | needs stop conditions, a rollback target, and a size capped by risk |
| Generally available | every readiness item complete, a recorded production approval, active monitoring; enables the organization's flag explicitly |

**Rollback:**
- **Manual:** restores the previous approved release, keeps conversations and audit history, and blocks the rolled-back release from re-promotion.
- **Automatic** (worker, every minute) for pilots and canaries on:
  - a declared SEV-0/1 incident or a critical safety event;
  - validation, provider-error or latency breaches;
  - cost anomaly or a negative-feedback spike.

**Feature flags** apply per environment, organization, role and member, and are enforced server-side. In production a capability is enabled only through an approved release, never by a flag alone and never for all organizations automatically.

## Cost governance

**Breakdowns:** cost by organization, capability, provider, model, user, workflow, prompt version and release.

**Unit costs:** per successful response, validated citation and approved action. There is also a linear monthly forecast.

**Separate figures, never mixed:**

| Figure | Source |
|---|---|
| Provider-reported usage | the provider's own token counts |
| Estimated cost | "Estimated — not a provider invoice" |
| Reconciled cost | invoices an administrator enters; ≤ 5 % difference counts as reconciled |
| Internal allocation | proportional to usage |
| Customer charge | none: no billing workflow, no markup |

Usage records now carry `capabilityKey`, `releaseId`, `promptVersion` and `billingSource`. Existing simulator usage was backfilled as "Simulator".

## Audit trail

Every governance action writes to the existing immutable audit log with actor, organization, action, target, previous and new state, reason and correlation ID:
- policy, provider, model, prompt, tool and workflow changes;
- evaluations, releases and rollbacks;
- kill switches, incidents and evidence access;
- exceptions, flags and exports.

No API can change or delete audit history.

**Reports and exports** (15 types):
- They are tenant-bounded and permission-checked, and exclude secrets and prompt text.
- Each export is audited with a content hash.
- The secure Document service (Phase 7) isn't built, so exports download directly.

## Docker Desktop services

**Default stack:** unchanged, and it starts without real provider keys.

**`docker compose --profile observability up -d`** adds:
- **Prometheus** on `127.0.0.1:9090`, scraping `api:4000/metrics`;
- **Grafana** on `127.0.0.1:3001`, with the provisioned "Caspira AI operations" dashboard.

`/metrics` is aggregate only and protected by `METRICS_TOKEN` (otherwise loopback and private networks only). There is no Alertmanager or log aggregation: alerting stays in the CRM.

**Health:**
- `/health` covers the API; `WORKER_PORT/health` covers the worker.
- `GET /api/v1/ai/governance/health` checks the database, the Redis queue, the simulator, and the worker, scheduler, evaluation-worker and monitoring-collector heartbeats.

**Environments:** `AI_ENVIRONMENT` is one of development, test, staging or production (default from `NODE_ENV`). The seeded development/test baseline flags don't apply in production.

## Commands

```
npx prisma migrate deploy                       # 20260926090000_phase11_ai_governance
node scripts/seedRoles.js                       # governance grants + AI Governance Administrator, AI Safety Reviewer
npm run db:seed:ai                              # registry, kill switches, flags, SLOs, alerts, graders, datasets, suites
docker compose up -d                            # default stack (no provider keys needed)
docker compose --profile observability up -d    # + Prometheus and Grafana
# Release-gate evaluation: POST /api/v1/ai/evaluations/runs {"suiteKey":"ai_copilot_release"}
# Local kill switch: AI Administration → Governance → Kill switches (or POST /api/v1/ai/kill-switches/:id/activate)
# Rollback test: AI Administration → Releases → Roll back
# Incident simulation: AI Administration → Incidents → Report → Contain → regression case → run → restoration
docker compose --profile observability down
```

## Migrations

`20260926090000_phase11_ai_governance`:
- **Adds 35 tables:** capabilities and versions; policies, versions and approvals; provider, model, prompt, tool and workflow governance; evaluation suites, datasets, versions, cases, graders, runs, results and comparisons; releases, gates, cohorts and flags; readiness items; safety events; incidents, events and evidence; kill switches; emergency exceptions; SLO definitions and measurements; alert rules and events; the human review queue; provider invoices.
- **Adds columns** on `ai_requests` (`capabilityKey`, `releaseId`, `safetyIdVersion`, `moderation`) and on `ai_usage_records` (`capabilityKey`, `releaseId`, `promptVersion`, `billingSource`).
- **Money** columns are Decimal. Tenant rows carry `organizationId`.

## Tests

**Backend: 513/513 pass** (up from 491), with no external provider requests. New tests:
- `governance.test.js` (21):
  - flags (organization over platform, environment, targeting, department/team fail closed, deny by default);
  - cohorts and release selection;
  - kill-switch matching and kinds;
  - HMAC safety identifier (no raw id);
  - output scanning (keys, passwords, Luhn cards);
  - direct, indirect and encoded injection detection;
  - local moderation;
  - code, schema, evidence and citation graders;
  - authoritative case outcome, human review and LLM disagreement;
  - dataset redaction;
  - zero-tolerance coverage of the seeded datasets;
  - the capability registry, prohibited automations, never-excepted controls, readiness, SLOs, alerts and CSV export.
- `copilot.test.js` (+1): secret-bearing fields never reach the model.

**Frontend: 1551/1551 pass.** `admin.test.jsx` (6) covers the grant-driven AI Administration pages, the access gate, no overall safety score, a kill switch requiring a written reason, evaluation gates shown with sample size and dataset version, and an SLO never shown as met without data.

**Build:** succeeds. **Lint:** no new problems (the 43 remaining are in older, untouched files). **Type checks:** none; the project is plain JavaScript.

**Live checks** (development database through the API, simulator mode, worker running). At commit time, **9 of 23 passed** and the rest were still running; nothing had failed. The passes:
- governance dashboard with no overall score;
- ordinary user and checker authorization;
- prohibited-capability rejection;
- Copilot and narrative under governance, with capability, safety-identifier and billing attribution;
- organization capability kill switch (reason required, audited, restored);
- global kill switch (System Owner only);
- tool kill switch (withheld and reported);
- server-side feature flags (the browser can't enable AI);
- moderation refusing credential and cross-tenant requests, with code-written safety events.

The remaining checks cover the evaluation gate and cancellation, incident containment and restoration, release SoD and approval, rollout and rollback, the policy lifecycle, exceptions, the review queue, monitoring, cost, reports, readiness, prompt governance and audit immutability. They run 15-case evaluation suites (about 8–10 minutes each at the tunnel's roughly 430 ms per query).

**Found and fixed by this phase's own checks:**
- **Record shaping (zero tolerance).** The zero-tolerance suite found that Copilot record shaping passed secret-named fields (e.g. `apiKey`) to the model. Fixed: such fields are dropped, and credential-like values are redacted.
- **Organization Administrator grant.** The role could not start evaluation runs; it now has `ai_gov_evaluations:manage`. Human case review stays with safety reviewers and governance administrators.

**Earlier runs (all later rerun):** earlier partial live runs also passed the emergency-exception check (forbidden controls, separate approver, System Owner review) and the review-queue check. The evaluation-cancellation check passed in a targeted rerun. Earlier failures were caused by the 5-minute HTTP wait (runs are now queued and polled), the missing evaluation grant, and leftover state from interrupted runs, which the check now cleans up first.

## Remaining limitations

- **No Department or Team model.** Flag and cohort targeting by department or team fails closed, and monitoring can't filter by them.
- **No secure Document service.** Phase 7 isn't built, so exports download directly (audited, hashed).
- **Alerts** use the existing notification outbox; there is no Alertmanager or log aggregation.
- **The LLM grader is uncalibrated.** It has no human-agreement data yet, so it never counts toward a gate.
- **External moderation (OpenAI)** is off by default. Default tests make no external provider requests.
- **Shadow traffic** mirrors gateway calls (including the Copilot's model steps) but not tool reads, which run once.
- **Environment separation** (credentials, keys, databases, queues, storage, budgets, monitoring, audit) is documented and enforced for the simulator; each environment's infrastructure still has to be provisioned separately.
- **Manual readiness items need people:** provider agreements, data handling, backups, restore tests, credential rotation, support process.
