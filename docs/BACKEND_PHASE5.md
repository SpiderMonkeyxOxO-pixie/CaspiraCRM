# Backend Phase 5 — Projects and Tasks

This document covers what Backend Phase 5 added on top of Phases 1–4
(auth/organizations/RBAC, CRM core, Sales, Support). It replaces the
pre-Phase-5 placeholders at `/api/v1/projects` and `/api/v1/tasks` with
organization-scoped implementations, and wires the frontend Projects pages
to them behind a flag. It does **not** add the won-deal → onboarding
project cascade, watchers, recurring-task generation, or Gantt/timeline
views. See "Deferred".

## What the placeholders got wrong

The old `routes/projectRoutes.js` and `routes/taskRoutes.js` (removed)
used bearer auth with no organization scoping and no permission checks.
Any logged-in user could list and edit every project and task. They also
passed `POST`/`PUT` bodies straight to Prisma (so a client could set
`loggedHours`, `status` or anything else), and stored comments and time
entries as JSON arrays holding only an author *name*.

## Architecture

```
server/src/routes/projects/projectRoutes.js
server/src/routes/projects/taskRoutes.js
server/src/controllers/projects/projectsController.js
server/src/controllers/projects/tasksController.js
server/src/services/projects/projectRulesService.js   (statuses, dependency-loop check, hasGrant)
src/Helpers/backendProjectsClient.js                   (API client, VITE_BACKEND_PROJECTS_MODE)
src/Helpers/projectsBackend.js                         (maps API records onto the Projects UI's shape)
```

These follow the same conventions as Phases 2–4:

- session-cookie auth, with CSRF protection on mutations;
- `requireCrmOrgPermission("projects" | "tasks", action)`, which checks the `organizationId` from the query or body against a live membership;
- an allow-list for every write (`utils/pickWritable.js`);
- an audit event for every mutation.

## Routes

### `/api/v1/projects`

| Route | Permission | Notes |
|---|---|---|
| `GET /`, `GET /:id` | `view` | The list is paged (`page`, `pageSize` ≤ 100). Filters: `status`, `companyId`, `ownerMembershipId`, `search`. |
| `POST /` | `create` | The owner defaults to the creator. Company, deal and owner are validated against the organization, and the deal must belong to the chosen company. |
| `PATCH /:id` | `edit` | Changes name, company, deal, status, dates, description and customer visibility. Changing the owner also needs `assign`. Moving to `Completed` sets `completedAt`, and moving away clears it. Takes an optional `version` (409 on conflict). |
| `POST /:id/milestones` | `edit` | `{ name, dueDate }`. Returns the whole project. |
| `POST /:id/milestones/:milestoneId/toggle` | `edit` | Flips the milestone, or sets it when `{ completed }` is given. Records who completed it and when. Returns the whole project. |

### `/api/v1/tasks`

| Route | Permission | Notes |
|---|---|---|
| `GET /`, `GET /:id` | `view` | The list is paged (`pageSize` ≤ 200). Filters: `projectId`, `status`, `priority`, `assigneeMembershipId` (or `unassigned`), `search`. |
| `POST /` | `create` | Needs a `projectId` for a project the caller can see. The task always starts in `To Do`. A completed project takes no new tasks. Without `assign`, a new task can only be assigned to the caller. |
| `PATCH /:id` | `edit` | Changes title, description, priority, status, due date, estimate, dependency and recurring. Reassigning needs `assign`. Moving to `Done` sets `completedAt`. |
| `POST /:id/comments` | `edit` | `{ message }`. The comment is attributed to the signed-in member. |
| `POST /:id/time` | `edit` | `{ hours, note }`. Hours must be more than 0 and at most 24 per entry. `loggedHours` is only ever incremented here. |

## Task dependencies

`dependsOnId` must point at another task in the same project. A task can't
depend on itself, and a chain can't loop back. A task can't move to
`Done` while the task it depends on isn't `Done` (`PROJECTS_DEPENDENCY_BLOCKED`).

## Data model

Migration `20260923150000_phase5_projects_tasks` is additive only:

- `Project` gains `organizationId`, `ownerMembershipId`, `created/updatedByMembershipId`, `completedAt` and `version`.
- `Task` gains `organizationId`, `assigneeMembershipId`, `created/updatedByMembershipId`, `completedAt` and `version`.
- `Milestone` gains `completedAt`, `completedByMembershipId` and `createdAt`.
- New tables:
  - `TaskComment`, which records each comment's author membership;
  - `TaskTimeEntry`, which records hours, a note and the author membership.

The legacy columns (`Project.ownerId`, `Task.assigneeId`, and the JSON
`comments`/`timeEntries` on `Task`) stay for rows created before Phase 5,
but nothing writes to them anymore.

## Permissions and scope

`projects` and `tasks` grants on the five built-in roles (`prisma/seed.js`):

| Role | `projects` | `tasks` |
|---|---|---|
| System Owner | view, create, edit, assign | view, create, edit, assign |
| Organization Administrator | view, create, edit, assign | view, create, edit, assign |
| Department Manager | view, create, edit, assign | view, create, edit, assign |
| Auditor/Checker | view, view_audit_history | view, view_audit_history |
| Standard Employee | view | view, create, edit |

Projects and tasks have no department or team of their own, so a scope
narrower than Organization means the following:

- **Projects:** those the member owns or created, or has a task assigned in.
- **Tasks:** those assigned to or created by the member, plus every task in projects they own.

## Frontend

`VITE_BACKEND_PROJECTS_MODE=true` routes `redux/projects/projectsSlice.js`
and `tasksSlice.js` through `projectsBackend.js`, which does two mappings:

- membership ids back to the UI's `owner`/`assignee` names;
- `TaskComment`/`TaskTimeEntry` back to the task's `comments`/`timeEntries` arrays.

In backend mode, the project Owner field, the new-task Assignee field and
the Assignee in the task detail become pickers of real members. Mock mode
keeps its free-text fields. Backend rule failures, such as a blocked
dependency or a missing `assign` grant, show as a toast.

Tasks without a due date now show "—" and no longer count as overdue. The
backend stores a missing date as `null`, and the pages previously rendered
that as 1970.

Frontend tests pin this flag off (`vite.config.js`).

## Verification

- `cd server && npm test`: 246 tests, 14 of them new. They cover:
  - the allow-list on create;
  - the owner defaulting to the creator;
  - status and date validation;
  - owner changes needing `assign`;
  - `completedAt` being set and cleared;
  - milestone toggling;
  - the scope filter;
  - tasks always starting in `To Do`;
  - self-only assignment without `assign`;
  - completed projects;
  - dependency blocking, cross-project dependencies and loops;
  - time logging limits.
- Frontend: 1,522 tests, 4 of them new, covering adapter shape mapping and the flag being off under test.
- Live check against the VPS dev database (8/8):
  1. Create a project: server-kept fields are ignored.
  2. Add a milestone and toggle it.
  3. Create tasks with a dependency and an assignee.
  4. Dependency blocking and loop rejection.
  5. The assignee (Own scope) sees only their task, and can comment and log time.
  6. A Standard Employee can't reassign (403), create projects (403) or read others' tasks (404).
  7. The Auditor is read-only.
  8. Completing the project blocks new tasks.

## Deferred

- The won-deal → onboarding project cascade (still mock-only in `createOnboardingProject`).
- Watchers and notifications.
- Recurring-task generation through the worker.
- Project templates.
- Customer-portal visibility (`customerVisible` is stored but not yet served to a portal).
- Deleting and archiving projects, tasks and milestones.
- Gantt/timeline views.
- Per-project budgets and time approval.
