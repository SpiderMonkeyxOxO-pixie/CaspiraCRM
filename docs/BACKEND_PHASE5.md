# Backend Phase 5 — Projects, Tasks, Workflows, Time Tracking and Delivery Management

This document reports Backend Phase 5 as completed against the owner's
Back-end (V) prompt; the checklist is in `docs/specs/BACKEND_PHASE5_SPEC.md`.
It replaces the earlier, narrower Phase 5 write-up (projects, tasks,
milestones, comments and hours only).

It was built in five steps:

| Commit | What |
|---|---|
| `a5266a3` | Data model; project lifecycle, portfolios, templates, members |
| `d288ba7` | Phases, milestones, boards and columns, tasks, assignees, checklist, dependencies, labels, comments |
| `0a79c83` | Time entries, approval, corrections, timers |
| `9701713` | Deliverables, risks, issues, change requests, baselines |
| (this commit) | Reports, workload, calendar feed, Customer Portal projects, fixture import, frontend adapters, docs |

**Not built, by design (the prompt's boundary):**

- payroll, attendance or any monitoring (no screenshots, activity or productivity tracking);
- invoicing, payments, accounting entries or automatic billing from time;
- file storage and e-signatures (deliverable acceptance is a recorded decision, not a signature);
- integrations (Git hosts, Jira and similar, chat, calendars, webhooks);
- AI of any kind;
- automatic approvals, acceptance or workflow code;
- hard deletion.

## Data model

Migration `20260924150000_phase5_projects_full` is additive and backfills
the rows created by the first Phase 5 migration
(`20260923150000_phase5_projects_tasks`):

- **New:** `ProjectPortfolio`, `ProjectTemplate` + `ProjectTemplateVersion`, `ProjectMember`, `ProjectPhase`, `ProjectBoard` + `BoardColumn`, `TaskAssignee`, `TaskChecklistItem`, `TaskDependency`, `ProjectLabel`, `ProjectActivity` (append-only), `WorkTimer`, `Deliverable` + `DeliverableDecision`, `ProjectRisk`, `ProjectIssue`, `ChangeRequest`, `ProjectBaseline`.
- **Extended:** `Project` (number, portfolio, type, health, manager, planned/actual dates, effort, budget, progress mode, customer summary, archive fields), `Milestone` (phase, owner, status, acceptance, customer visibility, version), `Task` (number, parent, phase, milestone, board/column, status category, effort in minutes, weight, blocked reason, archive fields), `TaskComment` (project-level comments, visibility, edit/archive), `TaskTimeEntry` (minutes, start/end, status, approval, correction link, source).
- **Numbers:** `PROJECT-`, `TASK-`, `CHANGE-`, `DELIVERABLE-YYYY-NNNNNN`, from the shared per-organization counter (safe under concurrency, never reused).

## Routes (all under `/api/v1`)

| Area | Routes |
|---|---|
| Portfolios | `projects/portfolios` — list, create, get, update |
| Templates | `projects/templates` — list, create, get, update, `new-version`; `projects/from-template` (with `preview: true` for a dry run) |
| Projects | `projects` — list, create; `:id` get, update, `transition`, `archive`, `restore`, `progress` (manual), `history` |
| Members | `:id/members` — list, add, update, remove |
| Milestones | `:id/milestones` — add, update, `achieve` (`toggle` kept for the existing UI) |
| Phases | `:id/phases` — list, add, update, `reorder` |
| Boards | `:id/boards` — list, add, update, `columns/reorder` |
| Labels | `:id/labels` — list, add |
| Tasks | `:id/tasks` — list, create, `bulk`, get, update, `assign`, `transition`, `archive`, `restore`, `dependencies` (add, remove), `checklist` (add, update, `reorder`) |
| Comments | `:id/comments` — list, add, edit, `archive` |
| Time | `projects/time-entries` — list, create, update, `submit`, `withdraw`, `approve`, `reject`, `correct` |
| Timers | `projects/timers/active`, `start`, `:id/pause`, `resume`, `stop`, `discard` |
| Deliverables | `:id/deliverables` — list, add, update, `submit`, `approve`, `request-changes`, `accept`, `reject` |
| Risks | `:id/risks` — list, add, update, `accept`, `close` |
| Issues | `:id/issues` — list, add, update, `resolve` |
| Change requests | `:id/change-requests` — list, add, update, `submit`, `approve`, `reject`, `cancel`, `apply-preview`, `apply` |
| Baselines | `:id/baselines` — list, add |
| Reports | `projects/summary`, `projects/workload`, `projects/calendar?from&to` |
| **Customer Portal** | `portal/projects` (list, get), `milestones`, `deliverables`, deliverable `accept` and `request-changes`, `comments` (list, post) |

Static paths (`portfolios`, `templates`, `summary`, `time-entries`,
`timers`…) are registered before `/:projectId`. The legacy `/api/v1/tasks`
routes stay for the existing pages.

**Idempotency keys** (header `Idempotency-Key`) are required on project
create, from-template (not previews), task create, timer start and stop,
time submit, deliverable submit and accept, change-request approve and
apply, baseline create, and the portal's deliverable decisions.

## Rules worth knowing

- **Lifecycle:** Draft → Planned → Active ↔ On Hold / At Risk → Completed; Cancelled and Archived. Activation needs a manager, dates and at least one member; completion needs required milestones and deliverables settled; cancelling and reopening need a reason (reopening also `projects:reopen`). Nothing transitions on its own. Every step writes `ProjectActivity` and an audit event.
- **Templates:** published versions are immutable; a project records the template version it came from, and later template edits don't touch it. From-template creates independent records inside one transaction.
- **Membership:** same organization only, allocation 0–100 %, suspended members can't be assignees, and project membership never grants other CRM or finance access.
- **Boards:** moves go through backend column rules (allowed previous columns, allowed roles, required fields, WIP limits); a column with active tasks can't be removed. No user code runs.
- **Tasks:** subtasks stay in the same project with no parent loops; blocking needs a reason; the task ID never changes on a board move; the checklist never completes a task.
- **Dependencies:** FS/SS/FF/SF with lag, same project, no self or indirect cycles, archived tasks excluded. The policy warns or blocks and never reschedules.
- **Time:** minutes are authoritative; positive and bounded; no future dates; overlaps refused. Only Drafts are editable, Submitted must be withdrawn first, Approved changes only through a linked correction with a reason. Nobody approves their own time (`PROJECTS_SEPARATION_OF_DUTIES`). No payroll or invoice is created.
- **Timers:** one active timer per member; starting twice returns the same timer; server time only; stopping produces a **Draft** entry the member must submit.
- **Deliverables:** the owner can't approve their own; rejection and change requests need a reason; a change after approval opens a new version; customers decide only on `Ready for Customer Review` items.
- **Risks** use probability and impact *levels* (no invented percentages); accepting needs `project_risks:accept` and a reason. **Issues** can link a Support ticket; the histories stay separate.
- **Change requests:** submitting snapshots the impact; the requester can't approve; approval changes nothing; applying needs `apply-preview` then `apply` with `confirm: true`.
- **Baselines** are immutable and numbered; schedule variance always names the baseline it's measured against.
- **Progress modes:** task count, weighted, milestone, or manual (needs `projects:override_progress` and a reason). Archived and cancelled tasks are excluded, and the response names the basis used.
- **Version checks** (409 on conflict) on project update/transition, phase reorder, milestone achieve, board config, task transition, checklist, time approval, deliverable review, risk acceptance, issue resolution and change-request decisions.

## Reports, workload and calendar

- `summary` applies the caller's scope before counting. Rates return numerator and denominator and say "Insufficient data" below 5 records. Effort and time figures need `project_time:view_team`; otherwise the block says `restricted`. Budget appears only with `projects:view_financial_fields`.
- `workload` returns allocation, estimates and submitted/approved time per member, and "Capacity not configured" instead of a utilization figure. Without organization scope, only the caller's own line is returned.
- `calendar` returns project, phase, milestone, task-due and deliverable-due dates with their source IDs. It never copies records or writes to an external calendar.

## Customer Portal

A portal login sees only projects of its own company that are marked
`customerVisible`, through dedicated serializers: customer summary,
progress, customer-visible milestones, deliverables and comments. Tasks,
time, estimates, workload, internal comments, risks, issues, change
requests, budget, members and audit data are never returned. Deliverable
decisions are recorded as immutable `DeliverableDecision` rows
(`actorType: Customer`). Portal logins get 404 from the staff API.

## Permissions

New modules (deny by default): `projects`, `tasks`, `project_portfolios`,
`project_templates`, `project_planning`, `project_time`, `deliverables`,
`project_risks`, `project_issues`, `change_requests`, `project_baselines`,
`project_reports`.

| Role | What it gets |
|---|---|
| System Owner, Organization Administrator | Everything, including audit and financial fields |
| Department Manager (Project Manager equivalent) | Runs projects in their scope, approves team time, reviews deliverables and change requests, accepts risks |
| Auditor / Checker | Read-only everywhere, including team time and reports |
| Standard Employee (Contributor) | Views their projects; works tasks; logs and submits own time; edits deliverables they own; raises issues and change requests. No reports, approvals or baselines |

Organization scope sees every project; narrower scopes see projects they
manage, belong to or created.

Run `node scripts/seedRoles.js` after deploying so existing organizations
get the new grants.

## Fixture import

`PROJECT_FIXTURE_ORG_ID=<org id> npm run seed:projects` (refuses to run in
production) imports a template, a portfolio and one onboarding project
with phases, milestones, tasks, a dependency chain, a checklist, approved
time, a risk, an issue, a deliverable and a baseline. It's keyed by name
and title, so re-running creates nothing twice, and it validates the
template (including dependency cycles) before writing.

## Frontend

`backendProjectsClient.js` now has adapters for every area above,
including the portal. Project and task create send an idempotency key, so
**the frontend and backend must be deployed together**. The Projects
status list gains `At Risk` and `Cancelled`, and time entries display
hours converted from minutes. The existing table, Kanban and detail pages
are unchanged; mock mode stays.

## Verification

- `cd server && npm test`: 340 tests pass (46 files), 47 of them in `controllers/projects`.
- Frontend: 1,526 tests pass; `vite build` succeeds.
- Live check against the VPS dev database: project setup, time rules (overlap, self-approval refused, approved immutable, correction), timer idempotency, deliverable review and customer acceptance through the portal, change-request apply with confirmation, baseline variance, scoped reports and a contributor's 403 on reports.

## Deferred

- New frontend screens for templates, boards configuration, time approval, deliverables, risks, issues, change requests, baselines and the customer portal: the adapters exist, the pages don't yet.
- The prompt's deterministic AI-preview scenarios (no AI in this phase).
- The won-deal → onboarding project cascade.
- Recurring-task generation in the worker, and project notifications.
- Configurable member capacity (workload shows "Capacity not configured").
- The prompt asks for roughly 110 test cases; 47 unit tests plus the live check cover the main rules, but not every listed case.
