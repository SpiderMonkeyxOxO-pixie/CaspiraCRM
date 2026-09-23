# Backend Phase 5 — Projects, Tasks, Workflows, Time Tracking and Delivery Management

This is a condensed checklist of the owner's "Back-end (V)" prompt, the
source of truth for this phase. Every requirement is kept; the wording is
shortened.

## Boundary: do NOT implement

- Workforce: payroll, attendance, surveillance of any kind (screenshots, keyboard or mouse, productivity tracking).
- Finance: invoicing, payments, accounting entries, automatic billing.
- Documents: real file storage, e-signatures.
- Integrations: GitHub, GitLab, Jira, Asana, Trello, ClickUp, Slack, Teams, Google Calendar, webhooks.
- AI: Claude or OpenAI, AI tasks, summaries or risk predictions.
- Automation: automatic project approval, deliverable acceptance or change-request approval; running arbitrary workflow code.
- Also out: hard deletion.
- Don't redesign the frontend routes or remove mock mode.

## Models and rules

- **Numbering:** `PROJECT-`, `TASK-`, `CHANGE-`, `DELIVERABLE-YYYY-NNNNNN` — per organization, safe under concurrency, never reused, searchable, compatible with fixture IDs.
- **Portfolio:** name, description, owner, department, status, visibility, audit fields, version, archived. Totals exclude inaccessible projects.
- **Project:**
  - number, portfolio, name, description, type, status, priority, health;
  - company, primary contact, source deal, order and contract, related tickets;
  - manager, department, team;
  - planned and actual start and end, planned effort, currency and budget (only if already supported);
  - customer-visible summary, progress mode and manual progress (only if allowed);
  - created, updated and archived by, archive reason, version.
  - Links must be in the same organization, and restricted sales or support data is never exposed.
- **Project lifecycle:**
  - Keep the frontend statuses where they exist; otherwise Draft, Planned, Active, On Hold, At Risk, Completed, Cancelled, Archived, with the spec's transitions.
  - Activating needs a manager, dates and members.
  - Completing needs the required deliverables and milestones reviewed.
  - Cancelling needs a reason; reopening needs a permission and a reason.
  - Archiving keeps everything. Every step is audited, and nothing completes automatically.
- **Template (versioned):**
  - type, phases, workflow, milestones, tasks, dependencies, roles, checklist templates, active, version.
  - Creating a project from one is explicit, previewed and idempotent. It creates independent records, keeps the template version, isn't affected by later template edits, and published versions are immutable.
- **Project Membership:**
  - role (Sponsor, Manager, Team Lead, Contributor, Reviewer, Observer, Customer Reviewer), access level, start and end, allocation % (bounded), active.
  - Same organization only. Suspended members can't stay assignees. Membership grants no other CRM or financial access. Customer reviewers use portal scope. Role changes are audited.
- **Phase:** order, planned and actual dates, status, owner, version. Reordering is transactional, and a phase with active tasks can't be deleted.
- **Milestone:**
  - phase, owner, planned date, completed date, status (Planned, In Progress, At Risk, Achieved, Missed, Cancelled), customer-visible, needs acceptance, version, archived.
  - Achieved only by a person or an explicit rule; overdue doesn't mean "failed" unless defined.
- **Board and columns:**
  - Board: name, default, active, version.
  - Columns: order, category (Backlog, Ready, In Progress, Review, Blocked, Completed, Cancelled), work-in-progress limit, completion flag, required fields, allowed previous columns, allowed roles.
  - Kanban moves use the backend rules. Reordering is transactional, work-in-progress limits are enforced, a column with active tasks can't be deleted, and no code runs.
- **Task:**
  - number, project, parent, phase, milestone, board, column, title, description, type, priority, status category;
  - owner, reporter, planned start and due, actual start, completed;
  - estimated and remaining effort, weight, progress, blocked flag and reason, customer-visible, audit fields, version, archived and reason.
  - Subtasks use the same model, in the same project, with no loops.
  - Parent completion policy is defined. Completion goes through workflow transitions. Blocked needs a reason. The ID stays the same across board moves.
- **Task assignees (normalized):** role, assigned by, assigned, removed. Must be active project members, no duplicates, audited.
- **Checklist items:** order, completed, completed by and date, version, archived. Protected against concurrent edits, and never completes the task automatically.
- **Dependency:**
  - Type FS, SS, FF or SF, lag with units, created by.
  - Same project, no self-dependency, no direct or indirect cycles. Archived tasks can't be used.
  - The policy warns or blocks, and never reschedules silently.
- **Labels:** name, normalized name, color **token**, description, scope, archived. No arbitrary CSS.
- **Comments:** project or task, author, visibility (Project Team, Restricted Management, Customer Visible — the last needs a permission), sanitized, edited, archived, version. Filtered by the backend.
- **Project Activity History (append-only):** project create and transition; manager and members; phases and milestones; tasks (create, assign, transition, complete); dependencies; time (submit, approve); deliverables; risks and issues; change-request decisions; baselines. Stores snapshots.
- **Time Entry:**
  - project, task, member, work date, start and end, **minutes**, description, billable, status (Draft, Submitted, Approved, Rejected), submitted, approved and rejected by and date, reason, source, version, archived.
  - Duration is positive and bounded, ranges are valid, and overlaps are detected.
  - Only Drafts can be edited; Submitted must be withdrawn or rejected first; Approved is immutable except through a correction.
  - Nobody approves their own. No payroll or invoices are created.
- **Timer:**
  - member, project, task, started, paused, accumulated, stopped, state (Running, Paused, Stopped, Discarded).
  - Active-timer limit, starting twice is idempotent, server time only.
  - Stopping creates a Draft time entry preview that a person must confirm. No surveillance.
- **Time approval:** needs project plus time-approval permission, separation of duties, rejection reason, read-only after approval, corrections linked with a reason, no payroll or billing, audited.
- **Deliverable:**
  - number, milestone, owner, reviewer, status (Draft, In Progress, Ready for Review, Changes Requested, Approved Internally, Ready for Customer Review, Accepted, Rejected, Cancelled), due, submitted, reviewed, accepted and rejected dates, reason, customer-visible, acceptance requirements, current version, version.
  - Submission and acceptance are done by people, rejection needs a reason, a change after approval creates a new version, and acceptance isn't an e-signature. No files.
- **Customer acceptance:** portal API; company and project relationship checked; customer-visible deliverables only; Accept, or Request Changes with a comment; immutable event; internal comments hidden.
- **Risk:**
  - category, probability and impact **levels**, priority, owner, response strategy, mitigation, trigger, status (Identified, Assessing, Monitoring, Mitigating, Closed, Accepted), review date, closed.
  - Accepting a risk needs a permission and a reason. No fake decimal probabilities.
- **Issue:** related task, priority, severity, owner, status (Open, Investigating, In Progress, Blocked, Resolved, Closed), detected, target, resolved, resolution summary. Can link to a Support ticket, but the histories stay separate.
- **Change Request:**
  - number, requested by, title, description, business reason, impact on scope, schedule, effort, budget (if permitted) and risk.
  - Status: Draft, Submitted, Under Review, Approved, Rejected, Scheduled, Implemented, Cancelled.
  - Reviewer, decision and reason, approved by and date, implemented.
  - Submitting takes an impact snapshot. The requester can't approve their own. Approval changes nothing by itself; applying needs a separate preview and confirmation.
  - Rejecting and cancelling need reasons. Decisions are append-only and audited.
- **Baseline (immutable):**
  - Snapshots of project, phase, milestone and task dates, effort, planned progress and budget (if authorized), plus who, when, reason and version.
  - Needs a permission. Earlier baselines are kept. Variance names the baseline used. Never rebaselined silently.
- **Workload:**
  - Uses memberships, allocation, estimates, date ranges, assignments and submitted or approved time.
  - Shows "Capacity not configured" instead of inventing figures. Others' workload is protected.
- **Progress modes:**
  - Completed-task count, weighted (the sum of completed weights ÷ the sum of included weights × 100), milestone completion, or manual (needs a permission and a reason).
  - Archived and cancelled tasks are excluded. Projects with no tasks are handled. There's no unexplained health score.

## APIs (under `/api/v1/projects`)

- **Portfolios:** `portfolios` — list, create, get, update.
- **Projects:**
  - root list and create; `:id` get and update;
  - `transition`, `archive`, `restore`, `history`;
  - `summary`, with static routes ordered before `:id`.
- **Templates:** `templates` — list, create, get, update, `new-version`; `from-template`.
- **Members:** `:id/members` — list, add, update, remove.
- **Phases:** `:id/phases` — list, add, update, `reorder`.
- **Milestones:** `:id/milestones` — list, add, update, `achieve`.
- **Boards:** `:id/boards` — list, add, update, `columns/reorder`.
- **Tasks:**
  - `:id/tasks` — list, create, get, update;
  - `assign`, `transition`, `archive`, `restore`;
  - `dependencies` (add, remove);
  - `bulk`.
- **Time entries:** `time-entries` — list, create, update, `submit`, `approve`, `reject`, `correct`.
- **Timers:** `timers/active`, `start`, `pause`, `resume`, `stop`, `discard`.
- **Deliverables:** `:id/deliverables` — list, add, update, `submit`, `approve`, `request-changes`.
- **Risks:** `:id/risks` — list, add, update, `accept`, `close`.
- **Issues:** `:id/issues` — list, add, update, `resolve`.
- **Change requests:** `:id/change-requests` — list, add, update, `submit`, `approve`, `reject`, `apply-preview`, `apply`.
- **Baselines:** `:id/baselines` — list, add.
- **Portal:**
  - `/portal/projects` (list, get), `milestones`, `deliverables`;
  - deliverable `accept` and `request-changes`;
  - `comments` (list, post).
  - Never exposes internal tasks, time, estimates, workload, internal comments, risks or issues, change-request approvals, budget, cost, audit or employee data.

## Permissions (deny by default)

- **Projects:** `projects.read/create/update/transition/archive/manage_members/templates.manage`.
- **Planning:** `projects.phases.manage`, `projects.milestones.manage`, `projects.boards.manage`.
- **Tasks:** `projects.tasks.read/create/update/assign/transition/archive/bulk`.
- **Time:** `projects.time.read_own/read_team/create/submit/approve/correct`.
- **Deliverables:** `projects.deliverables.read/manage/review/accept`.
- **Risks and issues:** `projects.risks.read/manage/accept`, `projects.issues.read/manage`.
- **Change requests:** `projects.change_requests.read/create/review/apply`.
- **Other:** `projects.baselines.read/create`, `projects.workload.read`, `projects.reports.read`, `projects.audit.read`.

Roles: System Owner, Org Admin, Executive, Department Manager, Project Manager, Team Lead, Contributor, Reviewer, Auditor (read-only) and Portal user, each with the scope described in the prompt.

## Other requirements

- **Protected fields:** budget, cost, rates, margin, individual workload, time notes, restricted comments, risk acceptance, change-request financial impact, employee data, audit. Protected everywhere: summaries, filters, sorting, search, exports, portal, errors, audit, AI evidence.
- **Version checks:** project update and transition, phase reorder, milestone completion, board configuration, task transition, checklist, dependencies, time approval, deliverable review, risk acceptance, issue resolution, change-request decisions.
- **Idempotency keys:** project create, from-template, task create, timer start and stop, time submit, deliverable submit and accept, change-request approve and apply, baseline create.
- **Reports (authorized first):**
  - Projects: active, by status, by manager, by team; planned vs actual; overdue projects, milestones and tasks.
  - Tasks: blocked, unassigned, by workflow status, completion rate, progress.
  - Time and effort: estimated vs logged effort, submitted vs approved time, allocation, workload by member.
  - Governance: open and high-impact risks, open and overdue issues, pending change requests, pending deliverable reviews, schedule variance, milestone achievement rate.
  - Rates show their denominators and currencies stay separate.
- **Calendar feed:** project, phase, milestone, task-due and deliverable-due dates; authorized; keeps source IDs; no copies; no external calendars.
- **Fixture import:** idempotent, cycle detection, recalculation, a mismatch report, and never in production.
- **Frontend adapters:** for every area above; table, Kanban, timeline and calendar kept; version conflicts shown; no silent mock fallback.
- **AI preview:** deterministic scenarios only.
- **Audit:** everything above, including portal deliverable decisions, with sensitive values redacted.
- **Tests and security:** about 110 test cases (see the original), plus the security list.
