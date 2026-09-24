# Backend Phase 11 — AI Governance, Safety Operations, Evaluation Management and Production Rollout (condensed checklist)

Source: the user's pasted Phase 11 prompt (2026-09-24). Outcome: **ready for an explicitly approved pilot**. Not general availability, not an external deployment, not a compliance certification.

## Boundaries (never)
- Enable AI for all organizations automatically; deploy externally; build autonomous agents; give models unrestricted tools.
- Let AI edit or approve its own policies, publish its own prompts, approve its own release or approve its own suggested actions.
- Use production CRM data in evaluations without authorization.
- Put keys in the frontend; expose raw sensitive prompts; store or display hidden reasoning.
- Rely only on a provider dashboard or provider evaluation service; use an LLM grader as the sole release authority.
- Claim compliance or Zero Data Retention unless verified, or claim readiness before release gates pass.
- Weaken authorization or separation of duties.

## Reuse
Authentication, tenant boundaries, RBAC, record authorization, masking, audit, approvals, notifications (outbox), the Phase 9 gateway, adapters, simulator, usage/cost ledger, the Phase 10 Copilot, workers and Docker.

## Routes (frontend): the "AI Administration" nav group
`/ai/governance`, `/ai/evaluations`, `/ai/monitoring`, `/ai/incidents`, `/ai/releases`, `/ai/usage`. Hidden from roles without permission; never shown to Sales Representatives or Portal users.

**Statuses:** Not configured, Draft, Under review, Changes requested, Approved, Evaluation failed, Ready for pilot, Pilot, Canary, Generally available, Paused, Blocked, Rolled back, Retired. There is no unexplained "overall safety score".

## Capability registry (seeded)
**Capabilities:** AI Intelligence Overview, AI Copilot, company briefing, meeting preparation, pipeline review, renewal review, data-quality review, daily preparation, suggested-action proposals, semantic retrieval, durable user memory, provider-managed conversation state, provider-hosted retrieval.

**Fields on each:**
- identity and purpose: id, name, description, purpose;
- owners: business, technical and risk;
- scope: organization scope, roles, modules, data classifications;
- approved components: providers, models, prompts, tools, workflows;
- controls: approvals, evaluation suite, retention, budget;
- release state: release state, current release;
- review dates: last review, next review, sunset;
- kill-switch state.

**Risk levels:**

| Risk | Examples |
|---|---|
| Low | navigation help, public Knowledge Base, summarizing the user's own non-sensitive record |
| Moderate | briefings, meeting preparation, pipeline summaries, data quality, cross-record analysis in scope |
| High | finance summaries, restricted documents, organization-wide analysis, renewal recommendations, owner assignment, customer-facing content |
| Prohibited automation | delete, archive, merge, send messages, approve quotes or discounts, confirm orders, activate contracts, payments or refunds, permission changes, signing, publishing restricted files, HR decisions, disabling security, modifying AI governance |

**Risk decides:** reviewers, evaluation depth, allowed providers/models/tools, human approvals, rollout size, monitoring frequency, retention and incident severity.

## Policy lifecycle
**States:** Draft → Submitted → Under review → Changes requested → Approved → Active → Paused → Superseded → Retired.

**A policy becomes Active only when:**
- the required reviewers approved;
- separation of duties passed;
- evaluation gates passed;
- the provider is verified;
- retention, budgets, monitoring and a rollback target exist.

Every version is immutable. For moderate and high risk, the author is never the sole approver.

## Provider, model, prompt, tool and workflow governance

**Provider fields:**
- status and credentials: provider status, credential status;
- contract: contract owner, DPA status;
- data: approved and prohibited classifications, region, residency;
- retention: retention mode, ZDR eligibility, hosted storage;
- limits: models, rate and spend limits;
- operations: incident contact, last verification, last security review, next review, deprecations, limitations.

**Provider statuses:** Not configured, Configured, Verification pending, Verified, Degraded, Rate limited, Suspended, Credential expired, Policy blocked, Unavailable.

Contract, residency, privacy and compliance fields stay "Unverified" until an authorized administrator confirms them.

**Models:**
- Fields: provider id, display name, capabilities, modalities, tools, structured output, context and output limits, retention class, approved and prohibited uses, pricing version, evaluation status, release status, verified date, deprecation date, replacement model, rollback model.
- Pin versions, never a moving alias. A model change needs contract, structured-output and tool tests, evaluation/cost/latency comparisons, a safety review, release approval, a canary and a rollback. There is no automatic migration.

**Prompts:**
- **States:** Draft, Internal testing, Evaluation, Under review, Approved, Active, Superseded, Retired.
- **Fields on each version:** id, version, capability, provider and model compatibility, input and output schemas, tool allowlist, data classifications, safety instructions, citation rules, refusal behaviour, human-approval behaviour, change summary, author, reviewers, evaluation results, approval/activation/retirement dates.
- **Rules:** a published prompt is immutable, prompts are never edited in place, and untrusted CRM values never go into system instructions.

**Tools:**
- **Fields:** id, name, description, version, read/proposal class, risk, permission, approval, modules, fields, input and output schemas, maximum results, maximum runtime, rate limit, audit behaviour, owner, evaluation suite, release state, kill switch.
- **Deny by default.** Writing a tool's code does not expose it to the model.
- **Activation needs:** registration, schema, authorization, tenant-isolation, sensitive-data and injection tests, plus evaluation and release approval.

**Workflows:**
- **Fields on each version:** id, version, purpose, steps, tools, maximum calls/runtime/cost, approval checkpoints, escalation, failure behaviour, rollback, owners, evaluations, release state.
- **Rules:** the model can't add steps, and nothing runs recursively or without limit.

## Evaluation (application-owned, provider-neutral)
**Objects:** datasets, dataset versions, cases, rubrics, graders, runs, comparisons, human reviews, release gates, audit. There is no dependency on OpenAI Evals.

**Dataset types:** synthetic, golden, regression, adversarial, injection, authorization, sensitive data, retrieval, citation, tool selection, action proposal, cost, latency, refusal, incident-derived, approved redacted production.

**Production-derived cases require:** authorization, redaction, purpose, an owner, retention, access control and deletion. They are never copied automatically.

**Grader order:**
1. code;
2. schema;
3. authorization;
4. evidence;
5. citation;
6. human;
7. a calibrated LLM grader.

- **Code graders check:** values, IDs, authorization, organization, masking, schema, routes, dates, currencies, tool calls, action types, citation coverage and leakage.
- **The LLM grader assesses** relevance, usefulness, clarity, tone, explanation and completeness only, never authorization. It runs isolated, with structured output and a rubric, minimal sensitive data, and recorded provider/model/prompt/usage. It is calibrated against human reviewers, tested for bias, is never the candidate model's sole judge, and stores the verdict only.
- **Disagreements between graders are displayed.**

**Dimensions measured:** accuracy, schema, citation precision and completeness, evidence authorization, retrieval relevance and recall, isolation, masking, injection, tool selection and arguments, action safety, approval compliance, hallucination, unsupported claims, refusal and false refusal, calibration, freshness, latency, availability, errors, tokens, cost, feedback, accessibility.

**Zero-tolerance gates** (any failure blocks, and no exception is possible):
- cross-tenant leakage, unauthorized record, credential leak;
- authentication or authorization bypass, restricted-field leak;
- prohibited action executed, action without approval;
- fabricated execution, autonomous destructive behaviour.

**Configurable quality gates:**
- **Measures:** citation precision and coverage, accuracy, retrieval relevance, unsupported-claim rate, refusal, tool success, workflow completion, latency, cost per success, negative feedback.
- **Stored with each result:** threshold, method, dataset version, sample size, result, reviewer, decision, expiry. Never show a percentage without its suite version and sample size.

**Comparisons:** provider, model, prompt, tool, workflow and retrieval configurations, across accuracy, safety, citations, retrieval, tools, refusals, latency, usage, cost and human reviews. Never choose on cost alone.

**Run states:** Draft, Queued, Running, Awaiting human review, Passed, Passed with warnings, Failed, Cancelled, Invalid, Superseded. An incomplete run never passes.

## Layered safety
| Layer | Controls |
|---|---|
| Input | authentication, rate limits, length, modules, injection, abuse, files and malware, sensitive classification, prohibited classification |
| Context | authorization first, tenant isolation, field minimization, masking, trusted/untrusted labels, limits, data origin |
| Tools | allowlist, schemas, permissions, rate limits, size limits, approvals, audit |
| Output | schema, citations, sensitive scan, unsupported claims, action policy, refusals, safe errors |
| Execution | confirmation, approver, concurrency, domain validation, idempotency, undo, kill switches |

**Moderation adapter (provider-neutral):** OpenAI moderation (when configured), provider moderation, app rules, a local simulator, or disabled. It never replaces authorization. It records category, policy version, decision, confidence class, provider, model, time and correlation ID only.

**Safety decisions:** Allow, Allow with warning, Require clarification, Require human review, Redact, Refuse, Rate limit, Suspend AI access, Escalate incident. A refusal hides prompts, explains itself, offers a safe alternative, is audited and exposes nothing restricted.

**Injection monitoring:** direct attempts, instructions hidden in documents, email or support content, tool output, credential extraction, cross-organization requests, approval bypass, prohibited tools, encoded content, repeated probing.

**Safety identifier:** an HMAC of user and organization with a dedicated secret. It is versioned and rotatable. Never a name, email or raw ID.

**Safety events:**
- **Categories:** injection, sensitive data, restricted retrieval, invalid citation, unauthorized tool, prohibited action, approval bypass, provider refusal, moderation block, excessive retries, abnormal usage, budget abuse, cross-tenant attempt, credential exposure, kill switch.
- **Fields:** organization, user, conversation, capability, severity, category, policy version, provider, model, safe summary, source, action, review status, correlation ID, date.
- **Severities:** Informational, Low, Medium, High, Critical. A Critical event opens an incident, notifies responders, preserves evidence, blocks promotion, contains the problem, and pauses the capability if configured.

## Kill switches
**Scopes:** global, provider, model, capability, tool, workflow, organization, semantic retrieval, provider storage, governed-action execution.

**Behaviour:**
- checked server-side, and effective without a redeploy;
- activation requires permission and a written reason, and is audited with a notice to administrators;
- new work stops, queued work is cancelled, and active work follows the policy;
- read-only history stays available.

The model never operates a kill switch.

## Incidents (`/ai/incidents`)
**Categories:** data leakage, authorization failure, injection, unsafe tool use, unauthorized action, hallucinated execution, provider outage, provider policy, credential exposure, cost anomaly, evaluation regression, retrieval corruption, model behaviour change, retention failure.

**States:** Detected → Triage → Contained → Investigating → Remediating → Monitoring → Resolved → Closed (and Reopened).

**Severity:**

| Level | Meaning |
|---|---|
| SEV-0 | systemic or cross-tenant exposure |
| SEV-1 | critical security or unauthorized execution |
| SEV-2 | major degradation or repeated safety failure |
| SEV-3 | limited issue |
| SEV-4 | minor |

**Workflow:**
1. Detect and create the incident.
2. Assign an owner and set the severity.
3. Contain, preserve evidence and notify.
4. Disable the capability where needed.
5. Investigate and record the root cause.
6. Remediate and create a regression case.
7. Validate, approve restoration, monitor and close.

There is no restoration until the regression suites pass.

**Evidence** is redacted metadata only:
- the request, response, tool calls, authorization/policy decisions;
- prompt and model versions, retrieval IDs, usage;
- correlation IDs and artifact hashes.

Evidence access is permission-controlled, audited, retention-governed and time-limited. Evidence never includes keys or tokens.

## Monitoring (`/ai/monitoring`)
**Metrics:** volume, active users, provider availability, model usage, latency, error rate, refusal rate, validation, citation, tool and retrieval failures, approval outcomes, safety events, incidents, tokens, cost, budget, drift, feedback.

**Filters:** date, organization, department, team, user, provider, model, capability, prompt, tool, workflow, severity, release, environment.

Monitoring never shows sensitive prompts or record labels.

**SLOs**, each with a measurement window:
- gateway and Copilot availability;
- time to first progress, completed latency;
- provider error rate, structured-output validity, citation validation, tool success;
- queue delay, index freshness, usage reconciliation;
- incident acknowledgement, kill-switch propagation.

**Alerts:**
- **Triggers:** provider outage, credential failure, rate-limit surge, budget, cost anomaly, validation/citation/retrieval/safety spikes, cross-tenant attempt, approval bypass, evaluation regression, model deprecation, prompt-release failure, queue backlog, index staleness.
- **Handling:** deduplication, cooldown, escalation, acknowledgement, resolution, suppression windows and audit, all through the existing notification system.

**Privacy monitoring:** categories sent to providers, storage mode, retention, deletion, retrieval sources, redaction counts, restricted blocks, hosted file and conversation inventories, expired data awaiting deletion.

**Immutable audit:**
- **Events:** policy create/approve, provider enable/disable, model approval, prompt publication, tool/workflow activation, evaluation run/approval, release promote/rollback, kill switch, incident changes, retention, emergency exceptions, evidence access.
- **Fields:** actor, organization, action, target, previous and new state, reason, correlation ID, time.

## Releases (`/ai/releases`)
**The manifest pins:**
- capability version, provider, model and settings;
- prompt and output-schema versions, deterministic selector;
- retrieval and embedding versions, tools, workflows;
- policy, evaluation suite, budget, retention, flags.

**States:** Draft, Testing, Evaluation failed, Awaiting approval, Approved, Shadow, Pilot, Canary, Generally available, Paused, Rolled back, Retired.

**Separation of duties (moderate and high risk):**
- the release author is not the sole approver;
- the prompt author is not the sole evaluator;
- the model-configuration owner is not the sole approver;
- activation needs an independent approval;
- an emergency override needs System Owner review.

**Stages:**

| Stage | Rules |
|---|---|
| Development | simulator, fixture data |
| Staging | sanitized data, explicit real-provider testing, strict budget, no actions |
| Shadow | nothing shown, no actions, separate accounting, data-policy and budget approval |
| Internal pilot | approved users, read-only tools |
| Organization pilot | an organization, roles and cohort, Organization Administrator approval |
| Canary | cohort, automatic stop conditions, rollback target |
| Generally available | all gates passed, monitoring on, opt-in, production approval |

A successful deploy is not approval for general availability.

**Feature flags** by environment, organization, department, team, role, user, capability, provider, model, tool and workflow. They are enforced server-side; the browser can't enable anything.

**Rollback** (automatic or manual) on:
- isolation failure, restricted leak, prohibited attempt;
- validation, citation or provider-error spikes;
- cost anomaly, latency breach, negative-feedback spike;
- evaluation regression, declared incident.

Rollback targets the affected capability and restores the last approved release. It keeps audit history, notifies responders, blocks actions during the transition, keeps conversations, and blocks re-promotion without review.

**Emergency exceptions:** a requester and a separate approver, a reason, scope, expiry, compensating controls, audit and a post-incident review. They expire automatically. Forbidden: cross-tenant access, credentials, authentication or permission bypass, automatic destructive actions, automatic permission changes.

## Cost governance
**Cost by:** organization, capability, provider, model, user, workflow, prompt and release. Also: cost per successful response, per validated citation and per approved action; forecasts, anomalies, BYOK visibility and invoice reconciliation.

**Keep separate:** provider-reported usage, estimated cost, reconciled cost, internal allocation and customer charge. No silent markup, and no automatic invoicing.

## Drift
Watch for model and SDK deprecations, schema, refusal, token-accounting, context-limit, pricing, retention, tool, latency and evaluation changes. A provider or model change creates a release candidate.

**Evaluations run:** before each release, after changes to prompts, models, tools, workflows, retrieval, the SDK or incidents, and on a schedule.

## Human review queue
**Queues:** failed evaluations, low confidence, incorrect or unsafe feedback, missing citations, sensitive-data alerts, injection events, high-risk releases, emergency exceptions, restoration.

Reviewers see only authorized context. **Decisions:** Approve, Reject, Request changes, Escalate.

## Reports and exports
**Reports:**
- inventories: capabilities, providers, models, prompts, tools, workflows;
- status and history: evaluation status, releases, incidents, safety trends;
- operations: usage and cost, retention, the policy-review schedule, exceptions, review workload.

**Exports:** permission-checked, tenant-bounded, without secrets, masked and audited, and through the secure Document service. That service is Phase 7, which isn't built; see the limitations.

## Data models
- **Registry:** `ai_capabilities`, `ai_capability_versions`, `ai_governance_policies`, `ai_governance_policy_versions`, `ai_provider_governance`, `ai_model_governance`, `ai_prompt_governance`, `ai_tool_governance`, `ai_workflow_governance`.
- **Evaluation:** `ai_evaluation_datasets`, `ai_evaluation_dataset_versions`, `ai_evaluation_cases`, `ai_evaluation_graders`, `ai_evaluation_runs*`, `ai_evaluation_results*`, `ai_evaluation_comparisons`.
- **Releases:** `ai_release_gates`, `ai_releases`, `ai_release_approvals`, `ai_rollout_cohorts`, `ai_feature_flags`.
- **Safety and incidents:** `ai_safety_events`, `ai_incidents`, `ai_incident_events`, `ai_incident_evidence`, `ai_kill_switches`, `ai_emergency_exceptions`.
- **Operations:** `ai_slo_definitions`, `ai_slo_measurements`, `ai_alert_rules`, `ai_alert_events`, `ai_human_review_items`.

Tenant-owned rows carry `organizationId`, and money is stored as Decimal.

\* Phase 9 already uses the `ai_evaluation_runs` and `ai_evaluation_results` table names, so Phase 11 uses `ai_eval_runs` and `ai_eval_results`.

## API (`/api/v1/ai/...`)
- **Governance:**
  - `GET /governance`;
  - capabilities: `GET/POST`;
  - policies: `GET/POST`, plus `versions`, `submit`, `approve`, `reject`, `pause`.
- **Evaluations:** suites and datasets (`GET/POST`), dataset versions; runs (`POST`, `GET :id`, `cancel`, `review`); `GET comparisons`.
- **Releases:** `GET/POST`, `GET :id`, then `submit`, `approve`, `promote`, `pause`, `rollback`, `retire`.
- **Monitoring:** `summary`, `metrics`, `safety-events`, `alerts`, plus `acknowledge` and `resolve`.
- **Incidents:** `GET/POST`, `GET/PATCH :id`, then `contain`, `resolve`, `close`, `reopen`, `create-regression-case`.
- **Kill switches:** `GET`, plus `:id/activate` and `:id/deactivate`.
- **Reviews:** `GET`, `GET :id`, then `approve`, `reject`, `request-changes`, `escalate`.

## Permissions
Mapped to this codebase's `module:action` grants:

| Prompt permission | Grant |
|---|---|
| `ai.governance.read`, `ai.governance.manage` | `ai_governance:{read,manage}` |
| `ai.policy.{create,review,approve}` | `ai_gov_policies:{create,review,approve}` |
| `ai.{provider,model,prompt,tool,workflow}.governance` | `ai_gov_registry:{providers,models,prompts,tools,workflows}` |
| `ai.evaluation.{read,manage,review}` | `ai_gov_evaluations:{read,manage,review}` |
| `ai.release.{create,approve,promote,rollback}` | `ai_releases:{create,approve,promote,rollback}` |
| `ai.monitoring.read` | `ai_monitoring:read` |
| `ai.safety.review` | `ai_safety:review` |
| `ai.incident.{create,manage}`, `ai.incident.evidence.read` | `ai_incidents:{create,manage,read_evidence}` |
| `ai.kill_switch.{activate,deactivate}` | `ai_kill_switches:{activate,deactivate}` |
| `ai.emergency_exception.{request,approve}` | `ai_emergency_exceptions:{request,approve}` |
| `ai.usage.governance` | `ai_usage_governance:read` |

**Roles:**

| Role | Access |
|---|---|
| System Owner | platform governance, global kill switch, critical incidents, platform releases; no automatic tenant data |
| Organization Administrator | organization policy, rollout, providers, incidents |
| AI Governance Administrator (new) | prompts, models, tools, workflows, suites; not the sole approver of their own high-risk release |
| AI Safety Reviewer (new) | safety events, failed evaluations, incidents, restoration |
| Auditor / Checker | read-only history, evaluations, audit |
| Department Manager | view capabilities, department usage, feedback |
| Standard Employee | view available capabilities, report unsafe behaviour |
| Portal user | nothing |

## Docker and environments
**Docker:**
- The default stack stays lightweight and starts without provider keys.
- An optional `observability` profile adds Prometheus and Grafana (plus Alertmanager if supported).
- **Health checks** for the API, database, queue, worker, scheduler, evaluation worker, monitoring collector and simulator.
- **Documented commands:** stack up, observability up, migrate, seed permissions and fixtures, release-gate evaluation, local kill switch, rollback test, incident simulation, dashboards, stack down.

**Environments** (Development, Test, Staging, Production) each have their own credentials, keys, databases, queues, storage, provider projects, budgets, flags, monitoring and audit.

**Production-readiness checklist** (machine- and human-readable). General availability is blocked while any mandatory item is incomplete.
- Reviews and data: provider agreement, data handling, retention.
- Operations: credential rotation, backups, restore, migrations.
- Tests passed: authorization, cross-tenant, sensitive data, injection, prohibited actions.
- Gates and people: evaluation gates, reviewers.
- Limits and alerts: budgets, rate limits, alerts.
- Controls tested: kill switches, rollback.
- Support: incident contacts, support process, limitations shown to users.
- Approvals: pilot cohort approved, production approval recorded.

## Tests (about 130 listed)
Governance, evaluations, graders, gates, moderation and injection, safety events, kill switches, incidents, monitoring and SLOs, alerts, releases and SoD, rollout stages, flags, rollback, exceptions, cost, retention, audit immutability, exports, Docker profiles, no external requests in default tests, responsiveness, keyboard use, ErrorBoundary, and all existing suites.

## Report headings
Governance routes, capability registry, risk classification, policy lifecycle, provider governance, model governance, prompt governance, tool and workflow governance, evaluation architecture, datasets and graders, release gates, safety controls, moderation and injection, safety events, kill switches, incidents, monitoring and SLOs, alerts, release management, staged rollout, rollback, cost governance, audit, Docker services, migrations, frontend tests, backend tests, build/lint/type-check, remaining limitations, pilot-readiness status.

Stop for approval before **Phase 12 — Analytics Warehouse, Scheduled Reports, Executive BI and Governed Data Exports**.
