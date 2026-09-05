// Centralized, provider-neutral frontend fixtures for Projects and
// Development Integrations (/admin/integrations/projects-development/*) —
// Phase 4 preview, extending (never forking) the Phase 1-3 Integration
// Center architecture in mockIntegrationsData.js.
//
// STRICT BOUNDARY: nothing here contacts a real provider, creates a real
// external Project/issue/repository, pushes a commit, opens a pull/merge
// request, triggers a build, or starts/rolls back a deployment. Every
// simulated connection stays "Frontend Connection Preview", every sync
// "Preview Synchronization", every external-creation action "Creation
// Preview".
//
// CRITICAL: a REAL, routed Projects/Tasks module already exists
// (mockProjectsData.js — projects/tasks arrays, real Redux slices at
// src/redux/projects/*, real routes at /projects/*). This file links to
// those real records via provider-reference metadata; it never creates a
// second, parallel Project/Task entity. `createOnboardingProject()` in
// mockProjectsData.js — a fully-built "Won Deal -> Project" cascade that
// was never wired to anything — is the function the Won-Deal workflow
// below finally calls, extended with `templateId`/`teamId` support.
//
// NO IMPORT FROM mockIntegrationsData.js HERE — DELIBERATELY, same
// circular-import hazard documented in mockSalesMarketingData.js and
// mockSupportCommunicationData.js's header comments. Provider-catalog
// factories come from the dependency-free mockIntegrationsContracts.js.
import {
  createIntegrationProvider,
  createIntegrationCapability,
  createIntegrationPlanRequirement,
} from "./mockIntegrationsContracts";
import { ORGANIZATIONS, DEFAULT_ORGANIZATION_ID, TEAMS, MEMBERS } from "./mockAccessData";
import { CRM_TEAM } from "./mockUsersData";
import { deals, findDeal, findCompany } from "./mockCrmData";
import { contractsForDeal } from "./mockContractData";
import { projects, tasks, findProject, createOnboardingProject } from "./mockProjectsData";
import { findTicket } from "./mockSupportData";

const ORG_HQ = ORGANIZATIONS[0]?.id || DEFAULT_ORGANIZATION_ID;
const ORG_NIMBUS = ORGANIZATIONS[1]?.id || ORG_HQ;
const ORG_SOLSTICE = ORGANIZATIONS[2]?.id || ORG_HQ;

const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(n) { return new Date(Date.now() - n * DAY_MS).toISOString(); }
function daysFromNow(n) { return new Date(Date.now() + n * DAY_MS).toISOString(); }
function hoursAgo(n) { return new Date(Date.now() - n * 60 * 60 * 1000).toISOString(); }

// Generic connection-health factory, same trivial local shape every prior
// phase's fixture file has defined for itself rather than importing
// mockIntegrationsData.js's createIntegrationHealth (would reopen the
// circular-import hazard for a one-line factory).
function health(overrides = {}) {
  return { status: "Healthy", lastCheckedAt: new Date().toISOString(), issues: [], ...overrides };
}

// ---------------------------------------------------------------------------
// Canonical enums
// ---------------------------------------------------------------------------
export const ProjectStatusCanonical = [
  "Planning", "Ready", "Active", "On Hold", "At Risk", "Completed", "Cancelled", "Archived",
];
export const WorkItemStatusCanonical = [
  "Backlog", "Ready", "In Progress", "Blocked", "In Review", "Done", "Cancelled",
];
export const PriorityCanonical = ["Urgent", "High", "Normal", "Low"];
export const MAPPING_REVIEW_REQUIRED = "Mapping Review Required";

export const WorkItemType = [
  "Epic", "Feature", "Story", "Task", "Bug", "Subtask", "Card", "Checklist Item",
  "Support Escalation", "Change Request",
];

export const BuildStatus = ["Queued", "Running", "Passed", "Failed", "Cancelled", "Skipped", "Unknown"];
export const DeploymentStatus = [
  "Pending Approval", "Queued", "In Progress", "Successful", "Failed", "Rolled Back", "Cancelled", "Unknown",
];

export const FieldOwnershipOptions = [
  "CRM is source of truth", "Provider is source of truth", "Most recently updated permitted value",
  "Manual review required", "One-way synchronization only", "Do not synchronize",
];

export const SyncConflictType = [
  "Project-status mismatch", "Task-status mismatch", "Priority mismatch", "Assignee mismatch",
  "Team mismatch", "Due-date mismatch", "Deleted provider record", "Deleted CRM record",
  "Concurrent update", "Duplicate Project", "Duplicate work item", "Unsupported work-item type",
  "Unknown provider status", "Unknown provider user", "Repository-link conflict", "Restricted field",
  "Stale provider data",
];
export const SyncConflictResolution = [
  "Keep CRM value", "Keep provider value", "Use newest permitted value", "Map manually",
  "Ignore preview event", "Unlink preview", "Retry preview synchronization", "Escalate for review",
];

// ---------------------------------------------------------------------------
// Providers — Jira/Asana/ClickUp/Trello/Monday.com ("Project Management",
// already an unused category from Phase 1) + GitHub/GitLab/Bitbucket
// ("Developer Tools", new). Capabilities are deliberately named per the
// spec's own capability lists so each provider's card is meaningfully
// distinct, not a template swap.
// ---------------------------------------------------------------------------
function pmCap(id, name, crmModule, extra = {}) {
  return createIntegrationCapability({ id, name, crmModule, direction: "read", requiredPermission: "project_integrations.view", ...extra });
}

export const PHASE4_PROVIDERS = [
  createIntegrationProvider({
    key: "jira", name: "Jira", category: "Project Management",
    shortDescription: "Preview Jira projects, issues, sprints and releases against linked CRM Projects.",
    longDescription: "Frontend-only preview of Atlassian Jira Cloud/Server project and issue metadata, mapped to Caspira Projects and Tasks.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Freemium", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Projects", "Tasks", "Development"],
    capabilities: [
      pmCap("jira_projects", "Projects", "Project"),
      pmCap("jira_issues", "Issues, Epics, Stories, Tasks, Bugs, Subtasks", "Task"),
      pmCap("jira_boards_sprints", "Boards and Sprints", "Task"),
      pmCap("jira_releases", "Versions and releases", "Project"),
      pmCap("jira_people", "Assignees and issue links", "Task"),
      createIntegrationCapability({ id: "jira_comments", name: "Comments and attachment metadata", crmModule: "Task", direction: "read", requiredPermission: "external_tasks.view", sensitiveData: true, description: "Metadata only — comment/attachment bodies are not imported in this preview." }),
    ],
    dataLeavingCrm: ["Nothing — Jira is read/preview only in this phase."],
    dataEnteringCrm: ["Project and issue reference metadata only — never source content."],
    knownLimitations: ["No real issue is ever created in Jira.", "Comment bodies and attachments are not synchronized."],
    securityNotes: ["No Jira API token is stored anywhere in this preview."],
    icon: "Kanban",
  }),
  createIntegrationProvider({
    key: "asana", name: "Asana", category: "Project Management",
    shortDescription: "Preview Asana workspaces, projects and tasks against linked CRM Projects.",
    longDescription: "Frontend-only preview of Asana workspace/team/project/task metadata.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Freemium", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Projects", "Tasks"],
    capabilities: [
      pmCap("asana_workspaces", "Workspaces and Teams", "Project"),
      pmCap("asana_projects_sections", "Projects and Sections", "Project"),
      pmCap("asana_tasks", "Tasks and Subtasks", "Task"),
      pmCap("asana_milestones", "Milestones and due dates", "Project"),
      pmCap("asana_dependencies", "Dependencies and custom-field references", "Task"),
    ],
    dataLeavingCrm: ["Nothing — Asana is read/preview only in this phase."],
    dataEnteringCrm: ["Task/project reference metadata only."],
    knownLimitations: ["Custom fields are referenced by name only, never their values."],
    securityNotes: ["No Asana personal access token is stored anywhere in this preview."],
    icon: "ListChecks",
  }),
  createIntegrationProvider({
    key: "clickup", name: "ClickUp", category: "Project Management",
    shortDescription: "Preview ClickUp spaces, lists and tasks against linked CRM Projects.",
    longDescription: "Frontend-only preview of ClickUp workspace/space/folder/list/task metadata.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Freemium", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Projects", "Tasks"],
    capabilities: [
      pmCap("clickup_workspaces", "Workspaces, Spaces and Folders", "Project"),
      pmCap("clickup_lists_tasks", "Lists, Tasks and Subtasks", "Task"),
      pmCap("clickup_statuses_priorities", "Statuses and Priorities", "Task"),
      pmCap("clickup_estimates", "Estimates and Dependencies", "Task"),
      pmCap("clickup_goals", "Goal references", "Project"),
    ],
    dataLeavingCrm: ["Nothing — ClickUp is read/preview only in this phase."],
    dataEnteringCrm: ["Task/list reference metadata only."],
    knownLimitations: ["Custom ClickApps fields are not represented."],
    securityNotes: ["No ClickUp API token is stored anywhere in this preview."],
    icon: "CheckSquare",
  }),
  createIntegrationProvider({
    key: "trello", name: "Trello", category: "Project Management",
    shortDescription: "Preview Trello boards and cards against linked CRM Projects.",
    longDescription: "Frontend-only preview of Trello workspace/board/list/card metadata.",
    authMethod: "Provider-Managed Authorization",
    pricingClassification: "Freemium", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Projects", "Tasks"],
    capabilities: [
      pmCap("trello_boards", "Workspaces and Boards", "Project"),
      pmCap("trello_lists_cards", "Lists and Cards", "Task"),
      pmCap("trello_checklists_labels", "Checklists and Labels", "Task"),
      pmCap("trello_members_dates", "Members and due dates", "Task"),
      createIntegrationCapability({ id: "trello_attachments", name: "Attachment metadata", crmModule: "Task", direction: "read", requiredPermission: "external_tasks.view", sensitiveData: true, description: "Metadata only — attachment files are never imported." }),
    ],
    dataLeavingCrm: ["Nothing — Trello is read/preview only in this phase."],
    dataEnteringCrm: ["Card/board reference metadata only."],
    knownLimitations: ["No epic/sprint concept — Trello cards map to a flat canonical Card type."],
    securityNotes: ["No Trello API key/token is stored anywhere in this preview."],
    icon: "Trello",
  }),
  createIntegrationProvider({
    key: "monday_com", name: "Monday.com", category: "Project Management",
    shortDescription: "Preview Monday.com boards and items against linked CRM Projects.",
    longDescription: "Frontend-only preview of Monday.com workspace/board/group/item/column metadata.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Freemium", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Projects", "Tasks"],
    capabilities: [
      pmCap("monday_boards", "Workspaces, Boards and Groups", "Project"),
      pmCap("monday_items", "Items and Subitems", "Task"),
      pmCap("monday_columns_statuses", "Columns, Statuses and Owners", "Task"),
      pmCap("monday_dates_deps", "Dates and Dependencies", "Task"),
    ],
    dataLeavingCrm: ["Nothing — Monday.com is read/preview only in this phase."],
    dataEnteringCrm: ["Item/board reference metadata only."],
    knownLimitations: ["Custom column types beyond status/date/people are shown as raw labels only."],
    securityNotes: ["No Monday.com API token is stored anywhere in this preview."],
    icon: "LayoutGrid",
  }),
  createIntegrationProvider({
    key: "github", name: "GitHub", category: "Developer Tools",
    shortDescription: "Preview GitHub repositories, issues, pull requests, Actions runs and deployments.",
    longDescription: "Frontend-only metadata preview of GitHub organizations/repositories/issues/PRs/Actions/deployments — never source code.",
    authMethod: "Provider-Managed Authorization",
    pricingClassification: "Freemium", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Development"],
    capabilities: [
      createIntegrationCapability({ id: "github_repos", name: "Organizations and Repositories", crmModule: "Project", direction: "read", requiredPermission: "repositories.view" }),
      createIntegrationCapability({ id: "github_issues", name: "Issues", crmModule: "Task", direction: "read", requiredPermission: "development_issues.view" }),
      createIntegrationCapability({ id: "github_branches_commits", name: "Branches and Commits (metadata only)", crmModule: "Project", direction: "read", requiredPermission: "repositories.view" }),
      createIntegrationCapability({ id: "github_prs_reviews", name: "Pull Requests and Reviews", crmModule: "Task", direction: "read", requiredPermission: "code_reviews.view" }),
      createIntegrationCapability({ id: "github_actions", name: "Actions workflow runs", crmModule: "Project", direction: "read", requiredPermission: "pipelines.view" }),
      createIntegrationCapability({ id: "github_deployments", name: "Releases and Deployments", crmModule: "Project", direction: "read", requiredPermission: "deployments.view", sensitiveData: true }),
    ],
    dataLeavingCrm: ["Nothing — GitHub is read/preview only in this phase."],
    dataEnteringCrm: ["Repository/issue/PR/pipeline/deployment reference metadata only. Source code, diffs and credentials are never retrieved or displayed."],
    knownLimitations: ["No commit content, diff or file browsing.", "No merge/approve/rerun action is real."],
    securityNotes: ["No GitHub personal access token or App private key is stored anywhere in this preview."],
    icon: "Github",
  }),
  createIntegrationProvider({
    key: "gitlab", name: "GitLab", category: "Developer Tools",
    shortDescription: "Preview GitLab groups, projects, merge requests, pipelines and deployments.",
    longDescription: "Frontend-only metadata preview of GitLab groups/projects/issues/MRs/CI-CD pipelines/deployments — never source code.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Freemium", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Development"],
    capabilities: [
      createIntegrationCapability({ id: "gitlab_groups_projects", name: "Groups, Projects and Repositories", crmModule: "Project", direction: "read", requiredPermission: "repositories.view" }),
      createIntegrationCapability({ id: "gitlab_issues", name: "Issues", crmModule: "Task", direction: "read", requiredPermission: "development_issues.view" }),
      createIntegrationCapability({ id: "gitlab_branches_commits", name: "Branches and Commits (metadata only)", crmModule: "Project", direction: "read", requiredPermission: "repositories.view" }),
      createIntegrationCapability({ id: "gitlab_mrs_reviews", name: "Merge Requests and Reviews", crmModule: "Task", direction: "read", requiredPermission: "code_reviews.view" }),
      createIntegrationCapability({ id: "gitlab_pipelines", name: "CI/CD pipelines", crmModule: "Project", direction: "read", requiredPermission: "pipelines.view" }),
      createIntegrationCapability({ id: "gitlab_deployments", name: "Releases and Deployments", crmModule: "Project", direction: "read", requiredPermission: "deployments.view", sensitiveData: true }),
    ],
    dataLeavingCrm: ["Nothing — GitLab is read/preview only in this phase."],
    dataEnteringCrm: ["Project/issue/MR/pipeline/deployment reference metadata only. Source code, diffs and credentials are never retrieved or displayed."],
    knownLimitations: ["No commit content, diff or file browsing.", "No merge/approve/retry action is real."],
    securityNotes: ["No GitLab personal access token is stored anywhere in this preview."],
    icon: "Gitlab",
  }),
  createIntegrationProvider({
    key: "bitbucket", name: "Bitbucket", category: "Developer Tools",
    shortDescription: "Preview Bitbucket repositories, pull requests, pipelines and deployments.",
    longDescription: "Frontend-only metadata preview of Bitbucket workspaces/repositories/PRs/pipelines/deployments — never source code.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Freemium", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Development"],
    capabilities: [
      createIntegrationCapability({ id: "bitbucket_repos", name: "Workspaces, Projects and Repositories", crmModule: "Project", direction: "read", requiredPermission: "repositories.view" }),
      createIntegrationCapability({ id: "bitbucket_branches_commits", name: "Branches and Commits (metadata only)", crmModule: "Project", direction: "read", requiredPermission: "repositories.view" }),
      createIntegrationCapability({ id: "bitbucket_prs_reviews", name: "Pull Requests and Reviews", crmModule: "Task", direction: "read", requiredPermission: "code_reviews.view" }),
      createIntegrationCapability({ id: "bitbucket_pipelines", name: "Pipelines", crmModule: "Project", direction: "read", requiredPermission: "pipelines.view" }),
      createIntegrationCapability({ id: "bitbucket_deployments", name: "Deployments", crmModule: "Project", direction: "read", requiredPermission: "deployments.view", sensitiveData: true }),
    ],
    dataLeavingCrm: ["Nothing — Bitbucket is read/preview only in this phase."],
    dataEnteringCrm: ["Repository/PR/pipeline/deployment reference metadata only. Source code, diffs and credentials are never retrieved or displayed."],
    knownLimitations: ["No commit content, diff or file browsing.", "No merge/approve/rerun action is real."],
    securityNotes: ["No Bitbucket app password is stored anywhere in this preview."],
    icon: "GitBranch",
  }),
];

// ---------------------------------------------------------------------------
// Project templates — never hard-coded inside a page component.
// ---------------------------------------------------------------------------
export function createProjectTemplate({
  id, name, defaultStatus = "Planning", phases = [], defaultMilestones = [], taskGroups = [],
  defaultDependencies = [], suggestedTeamDepartment = null, targetDurationDays = 30, providerDestination = null,
}) {
  return { id, name, defaultStatus, phases, defaultMilestones, taskGroups, defaultDependencies, suggestedTeamDepartment, targetDurationDays, providerDestination };
}

export const PROJECT_TEMPLATES = [
  createProjectTemplate({
    id: "tmpl_software_implementation", name: "Software Implementation",
    phases: ["Discovery", "Configuration", "Testing", "Go-Live", "Hypercare"],
    defaultMilestones: ["Kickoff", "Configuration Complete", "UAT Sign-off", "Go-Live"],
    taskGroups: ["Environment setup", "Data migration", "Integration configuration", "User acceptance testing"],
    suggestedTeamDepartment: "Support", targetDurationDays: 60, providerDestination: "jira",
  }),
  createProjectTemplate({
    id: "tmpl_website_development", name: "Website Development",
    phases: ["Discovery", "Design", "Build", "Review", "Launch"],
    defaultMilestones: ["Kickoff", "Design Sign-off", "Beta Release", "Go-Live"],
    taskGroups: ["Wireframes", "Visual design", "Front-end build", "QA pass"],
    suggestedTeamDepartment: "Support", targetDurationDays: 45, providerDestination: "trello",
  }),
  createProjectTemplate({
    id: "tmpl_customer_onboarding", name: "Customer Onboarding",
    phases: ["Kickoff", "Provisioning", "Training", "Handover"],
    defaultMilestones: ["Kickoff"],
    taskGroups: ["Schedule kickoff call", "Send welcome packet", "Provision customer account", "Assign onboarding specialist"],
    suggestedTeamDepartment: "Support", targetDurationDays: 21, providerDestination: null,
  }),
  createProjectTemplate({
    id: "tmpl_marketing_campaign_delivery", name: "Marketing Campaign Delivery",
    phases: ["Brief", "Creative", "Launch", "Reporting"],
    defaultMilestones: ["Creative Sign-off", "Campaign Launch"],
    taskGroups: ["Creative brief", "Asset production", "Channel setup"],
    suggestedTeamDepartment: "Marketing", targetDurationDays: 30, providerDestination: "asana",
  }),
  createProjectTemplate({
    id: "tmpl_support_transition", name: "Support Transition",
    phases: ["Handover", "Shadow Period", "Full Ownership"],
    defaultMilestones: ["Handover Complete"],
    taskGroups: ["Knowledge transfer", "Shadow support queue", "Escalation path confirmed"],
    suggestedTeamDepartment: "Support", targetDurationDays: 14, providerDestination: null,
  }),
  createProjectTemplate({
    id: "tmpl_contract_renewal", name: "Contract Renewal",
    phases: ["Review", "Negotiation", "Signature"],
    defaultMilestones: ["Renewal Signed"],
    taskGroups: ["Usage review", "Renewal proposal", "Signature collection"],
    suggestedTeamDepartment: "Sales", targetDurationDays: 30, providerDestination: null,
  }),
  createProjectTemplate({
    id: "tmpl_general_service_delivery", name: "General Service Delivery",
    phases: ["Planning", "Delivery", "Close-out"],
    defaultMilestones: ["Kickoff", "Delivery Complete"],
    taskGroups: ["Scope confirmation", "Delivery execution", "Close-out review"],
    suggestedTeamDepartment: null, targetDurationDays: 30, providerDestination: null,
  }),
];
export function findProjectTemplate(id) {
  return PROJECT_TEMPLATES.find((t) => t.id === id) || null;
}

// ---------------------------------------------------------------------------
// Field ownership — default table per the spec's ownership rules. One
// policy set per linked Project; every value stays user-configurable via
// the Mappings route, never hard-coded into a page component.
// ---------------------------------------------------------------------------
export function createFieldOwnershipPolicy({ field, ownership }) {
  return { field, ownership };
}
export function defaultFieldOwnershipPolicies() {
  return [
    createFieldOwnershipPolicy({ field: "Project status", ownership: "CRM is source of truth" }),
    createFieldOwnershipPolicy({ field: "Milestones", ownership: "CRM is source of truth" }),
    createFieldOwnershipPolicy({ field: "Project members", ownership: "CRM is source of truth" }),
    createFieldOwnershipPolicy({ field: "Project dates", ownership: "CRM is source of truth" }),
    createFieldOwnershipPolicy({ field: "Sprints", ownership: "One-way synchronization only" }),
    createFieldOwnershipPolicy({ field: "Development issues", ownership: "One-way synchronization only" }),
    createFieldOwnershipPolicy({ field: "Repository branches", ownership: "One-way synchronization only" }),
    createFieldOwnershipPolicy({ field: "Commits", ownership: "One-way synchronization only" }),
    createFieldOwnershipPolicy({ field: "Pull requests", ownership: "One-way synchronization only" }),
    createFieldOwnershipPolicy({ field: "Merge requests", ownership: "One-way synchronization only" }),
    createFieldOwnershipPolicy({ field: "Build results", ownership: "One-way synchronization only" }),
    createFieldOwnershipPolicy({ field: "Deployment results", ownership: "One-way synchronization only" }),
  ];
}

// ---------------------------------------------------------------------------
// External Project links — the ONE record per real, linked CRM Project.
// ---------------------------------------------------------------------------
export function createExternalProjectLink({
  id, crmProjectId, organizationId, providerKey, externalProjectId, externalProjectName,
  externalProjectType = "Software Project", templateId = null, syncState = "Synced",
  paused = false, lastPreviewSyncAt = null, fieldOwnership = null,
}) {
  return {
    id, crmProjectId, organizationId, providerKey, externalProjectId, externalProjectName,
    externalProjectType, templateId, syncState, paused, lastPreviewSyncAt,
    fieldOwnership: fieldOwnership || defaultFieldOwnershipPolicies(),
    health: health({}),
  };
}

const linkableProjects = projects.slice(0, 4);
export const EXTERNAL_PROJECT_LINKS = [
  createExternalProjectLink({ id: "epl_1", crmProjectId: linkableProjects[0]?._id, organizationId: ORG_HQ, providerKey: "jira", externalProjectId: "JIRA-CAS", externalProjectName: "Caspira Onboarding", templateId: "tmpl_customer_onboarding", lastPreviewSyncAt: hoursAgo(2) }),
  createExternalProjectLink({ id: "epl_2", crmProjectId: linkableProjects[1]?._id, organizationId: ORG_HQ, providerKey: "asana", externalProjectId: "asana_9821", externalProjectName: "Website Relaunch", templateId: "tmpl_website_development", lastPreviewSyncAt: hoursAgo(6) }),
  createExternalProjectLink({ id: "epl_3", crmProjectId: linkableProjects[2]?._id, organizationId: ORG_NIMBUS, providerKey: "monday_com", externalProjectId: "monday_4471", externalProjectName: "Nimbus Rollout", templateId: "tmpl_software_implementation", syncState: "Conflict", lastPreviewSyncAt: daysAgo(1) }),
  createExternalProjectLink({ id: "epl_4", crmProjectId: linkableProjects[3]?._id, organizationId: ORG_HQ, providerKey: "clickup", externalProjectId: "cu_list_552", externalProjectName: "Support Transition — Solstice", templateId: "tmpl_support_transition", paused: true, lastPreviewSyncAt: daysAgo(3) }),
];

export function findExternalProjectLink(id) {
  return EXTERNAL_PROJECT_LINKS.find((l) => l.id === id) || null;
}
export function findExternalProjectLinkByProjectId(crmProjectId) {
  return EXTERNAL_PROJECT_LINKS.find((l) => l.crmProjectId === crmProjectId) || null;
}
export function queryExternalProjectLinksLocal(filters = {}) {
  let results = EXTERNAL_PROJECT_LINKS.slice();
  if (filters.organizationId) results = results.filter((l) => l.organizationId === filters.organizationId);
  if (filters.providerKey) results = results.filter((l) => l.providerKey === filters.providerKey);
  return results;
}
export function unlinkExternalProject(linkId, reason) {
  if (!reason?.trim()) return { error: "A written reason is required to unlink an external Project." };
  const idx = EXTERNAL_PROJECT_LINKS.findIndex((l) => l.id === linkId);
  if (idx === -1) return { error: "Link not found." };
  const [removed] = EXTERNAL_PROJECT_LINKS.splice(idx, 1);
  return { removed, reason };
}
export function pauseExternalProjectLink(linkId, paused) {
  const link = findExternalProjectLink(linkId);
  if (!link) return { error: "Link not found." };
  link.paused = paused;
  return { link };
}
export function previewProjectSync(linkId) {
  const link = findExternalProjectLink(linkId);
  if (!link) return { error: "Link not found." };
  link.lastPreviewSyncAt = new Date().toISOString();
  if (link.syncState !== "Conflict") link.syncState = "Synced";
  return { link };
}

// ---------------------------------------------------------------------------
// Won Deal -> Project workflow. Validates, previews, and on confirmation
// calls the real createOnboardingProject() exactly once — no independent
// preview-only Project entity is ever created.
// ---------------------------------------------------------------------------
export function queryWonDealsReadyForProject() {
  return deals.filter((d) => d.stage === "Won" && !projects.some((p) => p.dealId === d._id));
}

export function validateWonDealForProject(dealId, { templateId, teamId, deliveryOwnerId, requireOrderOrContract = false } = {}) {
  const deal = findDeal(dealId);
  const checks = [];
  const pass = (label) => checks.push({ label, passed: true });
  const fail = (label) => checks.push({ label, passed: false });

  if (!deal) { fail("Deal exists"); return { valid: false, checks, deal: null }; }
  deal.stage === "Won" ? pass("Deal is Won") : fail("Deal is Won");
  const company = deal.companyId ? findCompany(deal.companyId) : null;
  company ? pass("Company exists") : fail("Company exists");
  deal.ownerId ? pass("Deal owner exists") : fail("Deal owner exists");
  (deal.lineItems && deal.lineItems.length > 0) ? pass("Products or Services exist") : fail("Products or Services exist");
  (deliveryOwnerId || teamId) ? pass("Delivery owner or team selected") : fail("Delivery owner or team selected");
  templateId && findProjectTemplate(templateId) ? pass("Project template selected") : fail("Project template selected");
  (deal.expectedClosingDate || deal.actualClosingDate) ? pass("Required dates present") : fail("Required dates present");
  if (requireOrderOrContract) {
    const hasContract = contractsForDeal(dealId).length > 0;
    hasContract ? pass("Required Order or Contract exists") : fail("Required Order or Contract exists");
  } else {
    pass("Required Order or Contract exists");
  }
  !projects.some((p) => p.dealId === dealId) ? pass("No duplicate Project already linked") : fail("No duplicate Project already linked");

  return { valid: checks.every((c) => c.passed), checks, deal };
}

export function previewProjectFromWonDeal(dealId, options = {}) {
  const { valid, checks, deal } = validateWonDealForProject(dealId, options);
  if (!deal) return { error: "Deal not found." };
  const template = options.templateId ? findProjectTemplate(options.templateId) : null;
  const owner = options.deliveryOwnerId ? CRM_TEAM.find((m) => m.id === options.deliveryOwnerId) : null;
  const team = options.teamId ? TEAMS.find((t) => t.id === options.teamId) : null;
  const company = deal.companyId ? findCompany(deal.companyId) : null;
  return {
    valid, checks,
    sourceDeal: { id: deal._id, name: deal.name, value: deal.value },
    company: company ? { id: company._id, name: company.name } : null,
    products: (deal.lineItems || []).map((li) => li.name || li.productName).filter(Boolean),
    orderOrContract: contractsForDeal(dealId)[0] || null,
    template: template ? { id: template.id, name: template.name } : null,
    proposedName: company ? `${company.name} Onboarding` : "New Delivery Project",
    proposedStartDate: new Date().toISOString(),
    proposedTargetDate: template ? daysFromNow(template.targetDurationDays) : daysFromNow(30),
    proposedManager: owner ? owner.name : null,
    proposedTeam: team ? team.name : null,
    proposedMilestones: template ? template.defaultMilestones : ["Kickoff"],
    proposedProvider: template?.providerDestination || null,
    requiredPermission: "external_projects.create_preview",
    requiredApprover: "Project Manager",
    duplicateWarning: projects.some((p) => p.dealId === dealId) ? "A Project is already linked to this Deal." : null,
    isPreview: true,
  };
}

let lastWonDealProjectUndo = null;
export function confirmProjectFromWonDeal(dealId, { templateId, teamId, deliveryOwnerId } = {}, actorName = "Preview User") {
  const { valid, deal } = validateWonDealForProject(dealId, { templateId, teamId, deliveryOwnerId, requireOrderOrContract: false });
  if (!deal) return { error: "Deal not found." };
  if (!valid) return { error: "This Deal does not yet meet all requirements for a Project preview." };
  const company = deal.companyId ? findCompany(deal.companyId) : null;
  const owner = deliveryOwnerId ? CRM_TEAM.find((m) => m.id === deliveryOwnerId) : null;
  const { project, tasks: createdTasks } = createOnboardingProject({
    companyId: deal.companyId, companyName: company?.name || "Unknown Company", dealId, owner: owner?.name || null,
  });
  project.templateId = templateId || null;
  project.teamId = teamId || null;
  project.createdByPreview = actorName;
  lastWonDealProjectUndo = { projectId: project._id, taskIds: createdTasks.map((t) => t._id) };
  return { project, tasks: createdTasks, isPreview: true };
}

export function undoLastWonDealProject() {
  if (!lastWonDealProjectUndo) return { error: "Nothing to undo in the current session." };
  const { projectId, taskIds } = lastWonDealProjectUndo;
  const pIdx = projects.findIndex((p) => p._id === projectId);
  if (pIdx >= 0) projects.splice(pIdx, 1);
  for (const taskId of taskIds) {
    const tIdx = tasks.findIndex((t) => t._id === taskId);
    if (tIdx >= 0) tasks.splice(tIdx, 1);
  }
  lastWonDealProjectUndo = null;
  return { undone: true };
}

// ---------------------------------------------------------------------------
// Work items — one preview record per real Task linked to an external
// provider work item.
// ---------------------------------------------------------------------------
export function createWorkItemPreview({
  id, crmTaskId, crmProjectId, organizationId, providerKey, externalId, type = "Task",
  canonicalStatus, canonicalPriority, sprintName = null, milestoneName = null,
  dependsOnExternalId = null, blockedByExternalId = null, updatedAt = new Date().toISOString(), syncState = "Synced",
}) {
  return {
    id, crmTaskId, crmProjectId, organizationId, providerKey, externalId, type,
    canonicalStatus, canonicalPriority, sprintName, milestoneName,
    dependsOnExternalId, blockedByExternalId, updatedAt, syncState,
  };
}

const linkableTasks = tasks.slice(0, 6);
const TASK_STATUS_TO_CANONICAL = { "To Do": "Backlog", "In Progress": "In Progress", Review: "In Review", Done: "Done" };
const TASK_PRIORITY_TO_CANONICAL = { Low: "Low", Medium: "Normal", High: "High", Urgent: "Urgent" };

export const WORK_ITEM_PREVIEWS = linkableTasks.map((t, i) => createWorkItemPreview({
  id: `wip_${i + 1}`, crmTaskId: t._id, crmProjectId: t.projectId, organizationId: ORG_HQ,
  providerKey: ["jira", "asana", "clickup", "trello", "monday_com", "jira"][i % 5],
  externalId: `EXT-${1000 + i}`, type: ["Task", "Story", "Bug", "Card", "Task", "Subtask"][i % 6],
  canonicalStatus: TASK_STATUS_TO_CANONICAL[t.status] || MAPPING_REVIEW_REQUIRED,
  canonicalPriority: TASK_PRIORITY_TO_CANONICAL[t.priority] || MAPPING_REVIEW_REQUIRED,
  sprintName: i % 2 === 0 ? "Sprint 14" : null,
  syncState: i === 2 ? "Conflict" : "Synced",
  updatedAt: hoursAgo(i + 1),
}));

export function findWorkItemPreview(id) {
  return WORK_ITEM_PREVIEWS.find((w) => w.id === id) || null;
}
export function queryWorkItemPreviewsLocal(filters = {}) {
  let results = WORK_ITEM_PREVIEWS.slice();
  if (filters.organizationId) results = results.filter((w) => w.organizationId === filters.organizationId);
  if (filters.providerKey) results = results.filter((w) => w.providerKey === filters.providerKey);
  if (filters.crmProjectId) results = results.filter((w) => w.crmProjectId === filters.crmProjectId);
  return results;
}
export function retryWorkItemSync(id) {
  const item = findWorkItemPreview(id);
  if (!item) return { error: "Work item not found." };
  item.updatedAt = new Date().toISOString();
  if (item.syncState === "Conflict") return { error: "Resolve the open conflict before retrying." };
  return { item };
}

// ---------------------------------------------------------------------------
// Status / priority / work-item-type mapping tables — reusable rows shown
// on the Mappings route for both Projects and Tasks.
// ---------------------------------------------------------------------------
export function createStatusMapping({ id, providerKey, providerValue, canonicalValue, direction = "Provider to CRM", ownership = "Provider is source of truth", validation = "Valid", fallback = MAPPING_REVIEW_REQUIRED, lastPreviewUseAt = null }) {
  return { id, providerKey, providerValue, canonicalValue, direction, ownership, validation, fallback, lastPreviewUseAt };
}

export const PROJECT_STATUS_MAPPINGS = [
  createStatusMapping({ id: "psm_1", providerKey: "jira", providerValue: "To Do", canonicalValue: "Planning", lastPreviewUseAt: hoursAgo(3) }),
  createStatusMapping({ id: "psm_2", providerKey: "jira", providerValue: "In Progress", canonicalValue: "Active", lastPreviewUseAt: hoursAgo(3) }),
  createStatusMapping({ id: "psm_3", providerKey: "asana", providerValue: "On Track", canonicalValue: "Active", lastPreviewUseAt: hoursAgo(6) }),
  createStatusMapping({ id: "psm_4", providerKey: "asana", providerValue: "At Risk", canonicalValue: "At Risk", lastPreviewUseAt: hoursAgo(6) }),
  createStatusMapping({ id: "psm_5", providerKey: "monday_com", providerValue: "Stuck", canonicalValue: MAPPING_REVIEW_REQUIRED, validation: "Unmapped", lastPreviewUseAt: daysAgo(1) }),
];
export const TASK_STATUS_MAPPINGS = [
  createStatusMapping({ id: "tsm_1", providerKey: "jira", providerValue: "Backlog", canonicalValue: "Backlog" }),
  createStatusMapping({ id: "tsm_2", providerKey: "jira", providerValue: "In Review", canonicalValue: "In Review" }),
  createStatusMapping({ id: "tsm_3", providerKey: "clickup", providerValue: "Blocked", canonicalValue: "Blocked" }),
  createStatusMapping({ id: "tsm_4", providerKey: "trello", providerValue: "Doing", canonicalValue: "In Progress" }),
  createStatusMapping({ id: "tsm_5", providerKey: "monday_com", providerValue: "Waiting on Client", canonicalValue: MAPPING_REVIEW_REQUIRED, validation: "Unmapped" }),
];
export const PRIORITY_MAPPINGS = [
  createStatusMapping({ id: "prm_1", providerKey: "jira", providerValue: "Highest", canonicalValue: "Urgent" }),
  createStatusMapping({ id: "prm_2", providerKey: "jira", providerValue: "Medium", canonicalValue: "Normal" }),
  createStatusMapping({ id: "prm_3", providerKey: "clickup", providerValue: "Urgent", canonicalValue: "Urgent" }),
  createStatusMapping({ id: "prm_4", providerKey: "trello", providerValue: "Green Label", canonicalValue: MAPPING_REVIEW_REQUIRED, validation: "Unmapped" }),
];
export const WORK_ITEM_TYPE_MAPPINGS = [
  createStatusMapping({ id: "wtm_1", providerKey: "jira", providerValue: "Story", canonicalValue: "Story" }),
  createStatusMapping({ id: "wtm_2", providerKey: "jira", providerValue: "Epic", canonicalValue: "Epic" }),
  createStatusMapping({ id: "wtm_3", providerKey: "trello", providerValue: "Card", canonicalValue: "Card" }),
  createStatusMapping({ id: "wtm_4", providerKey: "clickup", providerValue: "Milestone", canonicalValue: MAPPING_REVIEW_REQUIRED, validation: "Unmapped" }),
];

export function queryStatusMappingsLocal(table, filters = {}) {
  const source = { project: PROJECT_STATUS_MAPPINGS, task: TASK_STATUS_MAPPINGS, priority: PRIORITY_MAPPINGS, workItemType: WORK_ITEM_TYPE_MAPPINGS }[table] || [];
  let results = source.slice();
  if (filters.providerKey) results = results.filter((m) => m.providerKey === filters.providerKey);
  return results;
}

// ---------------------------------------------------------------------------
// User / Team mapping — verified-email matching only, same pattern as
// Phase 3's resolveCrmTeamIdByMemberEmail. Never matched by display name.
// ---------------------------------------------------------------------------
function resolveCrmTeamIdByMemberEmail(email) {
  const member = MEMBERS.find((m) => m.email === email);
  if (!member) return null;
  const teamMember = CRM_TEAM.find((t) => t.name === member.name);
  return teamMember?.id || null;
}

export function createUserMapping({ id, providerKey, providerUserId, providerUserName, providerUserEmail, organizationId }) {
  const crmUserId = resolveCrmTeamIdByMemberEmail(providerUserEmail);
  const member = MEMBERS.find((m) => m.email === providerUserEmail);
  const memberOrgOk = member ? true : false; // MEMBERS is org-agnostic in this fixture set; presence = same-org verified
  let state = "No Match";
  if (crmUserId && memberOrgOk) state = "Matched";
  else if (member && !crmUserId) state = "Multiple Matches";
  else state = "No Match";
  return { id, providerKey, providerUserId, providerUserName, providerUserEmail, organizationId, crmUserId, state };
}

export const USER_MAPPINGS = [
  createUserMapping({ id: "um_1", providerKey: "jira", providerUserId: "jira_acc_1", providerUserName: "Liam O'Connor", providerUserEmail: "liam.oconnor@caspira.example", organizationId: ORG_HQ }),
  createUserMapping({ id: "um_2", providerKey: "github", providerUserId: "gh_2", providerUserName: "Grace Kim", providerUserEmail: "grace.kim@caspira.example", organizationId: ORG_HQ }),
  createUserMapping({ id: "um_3", providerKey: "asana", providerUserId: "asana_9", providerUserName: "Unknown Contractor", providerUserEmail: "contractor@unmapped.example", organizationId: ORG_NIMBUS }),
];
export function queryUserMappingsLocal(filters = {}) {
  let results = USER_MAPPINGS.slice();
  if (filters.organizationId) results = results.filter((u) => u.organizationId === filters.organizationId);
  return results;
}

export function createTeamMapping({ id, providerKey, providerTeamId, providerTeamName, organizationId, crmTeamId = null }) {
  return { id, providerKey, providerTeamId, providerTeamName, organizationId, crmTeamId };
}
export const TEAM_MAPPINGS = [
  createTeamMapping({ id: "tm_1", providerKey: "jira", providerTeamId: "jira_team_1", providerTeamName: "Delivery Squad", organizationId: ORG_HQ, crmTeamId: TEAMS[0]?.id || null }),
  createTeamMapping({ id: "tm_2", providerKey: "github", providerTeamId: "gh_team_eng", providerTeamName: "Engineering", organizationId: ORG_HQ, crmTeamId: TEAMS[0]?.id || null }),
];
export function queryTeamMappingsLocal(filters = {}) {
  let results = TEAM_MAPPINGS.slice();
  if (filters.organizationId) results = results.filter((t) => t.organizationId === filters.organizationId);
  return results;
}

// ---------------------------------------------------------------------------
// Development — repositories, issues, code reviews (PR/MR unified),
// pipeline runs, deployments, releases. Metadata only — no clone URL,
// token, diff, or source content ever appears in any of these shapes.
// ---------------------------------------------------------------------------
export function createRepositoryReference({ id, providerKey, organizationId, name, crmProjectId = null, visibility = "Private", defaultBranch = "main", openIssueCount = 0, openReviewCount = 0, lastActivityAt = new Date().toISOString() }) {
  return { id, providerKey, organizationId, name, crmProjectId, visibility, defaultBranch, openIssueCount, openReviewCount, lastActivityAt, health: health({}) };
}
export const REPOSITORIES = [
  createRepositoryReference({ id: "repo_1", providerKey: "github", organizationId: ORG_HQ, name: "caspira/onboarding-service", crmProjectId: linkableProjects[0]?._id, visibility: "Private", openIssueCount: 4, openReviewCount: 2, lastActivityAt: hoursAgo(3) }),
  createRepositoryReference({ id: "repo_2", providerKey: "gitlab", organizationId: ORG_HQ, name: "caspira/website", crmProjectId: linkableProjects[1]?._id, visibility: "Internal", openIssueCount: 7, openReviewCount: 1, lastActivityAt: hoursAgo(9) }),
  createRepositoryReference({ id: "repo_3", providerKey: "bitbucket", organizationId: ORG_NIMBUS, name: "nimbus/rollout-tools", crmProjectId: linkableProjects[2]?._id, visibility: "Private", openIssueCount: 2, openReviewCount: 0, lastActivityAt: daysAgo(2) }),
];
export function findRepository(id) { return REPOSITORIES.find((r) => r.id === id) || null; }
export function queryRepositoriesLocal(filters = {}) {
  let results = REPOSITORIES.slice();
  if (filters.organizationId) results = results.filter((r) => r.organizationId === filters.organizationId);
  if (filters.providerKey) results = results.filter((r) => r.providerKey === filters.providerKey);
  return results;
}

export function createDevelopmentIssuePreview({ id, providerKey, organizationId, repositoryId, crmProjectId = null, crmTicketId = null, title, type = "Bug", canonicalStatus, canonicalPriority, assignee = null, labels = [], updatedAt = new Date().toISOString(), sourceTicketSummary = null }) {
  return { id, providerKey, organizationId, repositoryId, crmProjectId, crmTicketId, title, type, canonicalStatus, canonicalPriority, assignee, labels, updatedAt, sourceTicketSummary };
}
export const DEVELOPMENT_ISSUES = [
  createDevelopmentIssuePreview({ id: "devi_1", providerKey: "github", organizationId: ORG_HQ, repositoryId: "repo_1", crmProjectId: linkableProjects[0]?._id, title: "Provisioning fails for EU tenants", type: "Bug", canonicalStatus: "In Progress", canonicalPriority: "High", assignee: "Grace Kim", labels: ["bug", "onboarding"], updatedAt: hoursAgo(2) }),
  createDevelopmentIssuePreview({ id: "devi_2", providerKey: "gitlab", organizationId: ORG_HQ, repositoryId: "repo_2", crmProjectId: linkableProjects[1]?._id, title: "Homepage hero image not lazy-loaded", type: "Task", canonicalStatus: "Backlog", canonicalPriority: "Low", assignee: null, labels: ["performance"], updatedAt: daysAgo(1) }),
];
export function findDevelopmentIssue(id) { return DEVELOPMENT_ISSUES.find((i) => i.id === id) || null; }
export function queryDevelopmentIssuesLocal(filters = {}) {
  let results = DEVELOPMENT_ISSUES.slice();
  if (filters.organizationId) results = results.filter((i) => i.organizationId === filters.organizationId);
  if (filters.repositoryId) results = results.filter((i) => i.repositoryId === filters.repositoryId);
  return results;
}
export function createDevelopmentIssueFromTicket(ticketId, { providerKey, repositoryId, type, priority, assignee, labels = [] }, actorName = "Preview User") {
  const ticket = findTicket(ticketId);
  if (!ticket) return { error: "Support Ticket not found." };
  const issue = createDevelopmentIssuePreview({
    id: `devi_${DEVELOPMENT_ISSUES.length + 1}`, providerKey, organizationId: ORG_HQ, repositoryId,
    crmTicketId: ticketId, title: ticket.subject, type: type || "Bug", canonicalStatus: "Backlog",
    canonicalPriority: priority || "Normal", assignee: assignee || null, labels,
    sourceTicketSummary: ticket.subject,
  });
  DEVELOPMENT_ISSUES.unshift(issue);
  return { issue, createdBy: actorName, isPreview: true };
}

export function createCodeReviewReference({ id, providerKey, organizationId, repositoryId, kind = "Pull Request", externalId, author, reviewers = [], status = "Open", checksStatus = "Pending", linkedWorkItemId = null, mergeStatePreview = "Clean", updatedAt = new Date().toISOString() }) {
  return { id, providerKey, organizationId, repositoryId, kind, externalId, author, reviewers, status, checksStatus, linkedWorkItemId, mergeStatePreview, updatedAt };
}
export const CODE_REVIEWS = [
  createCodeReviewReference({ id: "cr_1", providerKey: "github", organizationId: ORG_HQ, repositoryId: "repo_1", kind: "Pull Request", externalId: "#142", author: "Grace Kim", reviewers: ["Liam O'Connor"], status: "Awaiting Review", checksStatus: "Passed", updatedAt: hoursAgo(4) }),
  createCodeReviewReference({ id: "cr_2", providerKey: "gitlab", organizationId: ORG_HQ, repositoryId: "repo_2", kind: "Merge Request", externalId: "!58", author: "Priya Nair", reviewers: [], status: "Approved", checksStatus: "Passed", mergeStatePreview: "Ready", updatedAt: hoursAgo(1) }),
];
export function queryCodeReviewsLocal(filters = {}) {
  let results = CODE_REVIEWS.slice();
  if (filters.organizationId) results = results.filter((r) => r.organizationId === filters.organizationId);
  if (filters.repositoryId) results = results.filter((r) => r.repositoryId === filters.repositoryId);
  return results;
}

export function createPipelineRunReference({ id, providerKey, organizationId, repositoryId, name, branch, commitRef, status = "Queued", startedAt = new Date().toISOString(), durationSeconds = 0, triggeredBy = "Preview User", crmProjectId = null, failureStage = null }) {
  return { id, providerKey, organizationId, repositoryId, name, branch, commitRef, status, startedAt, durationSeconds, triggeredBy, crmProjectId, failureStage };
}
export const PIPELINE_RUNS = [
  createPipelineRunReference({ id: "pl_1", providerKey: "github", organizationId: ORG_HQ, repositoryId: "repo_1", name: "CI", branch: "main", commitRef: "a1b2c3d", status: "Passed", startedAt: hoursAgo(3), durationSeconds: 240, crmProjectId: linkableProjects[0]?._id }),
  createPipelineRunReference({ id: "pl_2", providerKey: "gitlab", organizationId: ORG_HQ, repositoryId: "repo_2", name: "build-and-test", branch: "feature/hero", commitRef: "d4e5f6a", status: "Failed", startedAt: hoursAgo(5), durationSeconds: 130, crmProjectId: linkableProjects[1]?._id, failureStage: "Unit Tests" }),
  createPipelineRunReference({ id: "pl_3", providerKey: "bitbucket", organizationId: ORG_NIMBUS, repositoryId: "repo_3", name: "pipeline", branch: "main", commitRef: "7788aef", status: "Running", startedAt: hoursAgo(0), durationSeconds: 0, crmProjectId: linkableProjects[2]?._id }),
];
export function queryPipelineRunsLocal(filters = {}) {
  let results = PIPELINE_RUNS.slice();
  if (filters.organizationId) results = results.filter((p) => p.organizationId === filters.organizationId);
  if (filters.status) results = results.filter((p) => p.status === filters.status);
  return results;
}

export function createDeploymentReference({ id, providerKey, organizationId, crmProjectId = null, repositoryId, environment = "Staging", releaseId = null, status = "Queued", startedAt = new Date().toISOString(), completedAt = null, initiatedBy = "Preview User", approvalStatus = "Not Required", rollbackAvailable = false, urlRestricted = true }) {
  return { id, providerKey, organizationId, crmProjectId, repositoryId, environment, releaseId, status, startedAt, completedAt, initiatedBy, approvalStatus, rollbackAvailable, urlRestricted, dataFreshness: new Date().toISOString() };
}
export const DEPLOYMENTS = [
  createDeploymentReference({ id: "dep_1", providerKey: "github", organizationId: ORG_HQ, crmProjectId: linkableProjects[0]?._id, repositoryId: "repo_1", environment: "Production", status: "Successful", startedAt: hoursAgo(4), completedAt: hoursAgo(4), approvalStatus: "Approved", rollbackAvailable: true }),
  createDeploymentReference({ id: "dep_2", providerKey: "gitlab", organizationId: ORG_HQ, crmProjectId: linkableProjects[1]?._id, repositoryId: "repo_2", environment: "Staging", status: "Failed", startedAt: hoursAgo(6), completedAt: hoursAgo(6), approvalStatus: "Not Required" }),
  createDeploymentReference({ id: "dep_3", providerKey: "bitbucket", organizationId: ORG_NIMBUS, crmProjectId: linkableProjects[2]?._id, repositoryId: "repo_3", environment: "Production", status: "Pending Approval", startedAt: hoursAgo(1), approvalStatus: "Pending" }),
];
export function queryDeploymentsLocal(filters = {}) {
  let results = DEPLOYMENTS.slice();
  if (filters.organizationId) results = results.filter((d) => d.organizationId === filters.organizationId);
  if (filters.status) results = results.filter((d) => d.status === filters.status);
  return results;
}

export function createReleaseReference({ id, providerKey, organizationId, crmProjectId = null, name, version, publishedAt = new Date().toISOString() }) {
  return { id, providerKey, organizationId, crmProjectId, name, version, publishedAt };
}
export const RELEASES = [
  createReleaseReference({ id: "rel_1", providerKey: "github", organizationId: ORG_HQ, crmProjectId: linkableProjects[0]?._id, name: "Onboarding Service v1.4.0", version: "1.4.0", publishedAt: hoursAgo(4) }),
  createReleaseReference({ id: "rel_2", providerKey: "gitlab", organizationId: ORG_HQ, crmProjectId: null, name: "Unlinked Release", version: "0.9.0", publishedAt: daysAgo(2) }),
];
export function queryReleasesLocal(filters = {}) {
  let results = RELEASES.slice();
  if (filters.organizationId) results = results.filter((r) => r.organizationId === filters.organizationId);
  return results;
}

// ---------------------------------------------------------------------------
// Synchronization conflicts.
// ---------------------------------------------------------------------------
export function createProjectSyncConflict({ id, organizationId, conflictType, providerValue, crmValue, linkId = null, workItemId = null, resolutionState = "Open", resolution = null, resolvedAt = null }) {
  return { id, organizationId, conflictType, providerValue, crmValue, linkId, workItemId, resolutionState, resolution, resolvedAt };
}
export const PROJECT_SYNC_CONFLICTS = [
  createProjectSyncConflict({ id: "psc_1", organizationId: ORG_NIMBUS, conflictType: "Project-status mismatch", providerValue: "Stuck", crmValue: "Active", linkId: "epl_3" }),
  createProjectSyncConflict({ id: "psc_2", organizationId: ORG_HQ, conflictType: "Task-status mismatch", providerValue: "Blocked", crmValue: "In Progress", workItemId: "wip_3" }),
];
export function querySyncConflictsLocal(filters = {}) {
  let results = PROJECT_SYNC_CONFLICTS.slice();
  if (filters.organizationId) results = results.filter((c) => c.organizationId === filters.organizationId);
  if (filters.resolutionState) results = results.filter((c) => c.resolutionState === filters.resolutionState);
  return results;
}
export function resolveSyncConflict(conflictId, resolution, actorName = "Preview User") {
  const conflict = PROJECT_SYNC_CONFLICTS.find((c) => c.id === conflictId);
  if (!conflict) return { error: "Conflict not found." };
  if (!SyncConflictResolution.includes(resolution)) return { error: "Unknown resolution." };
  conflict.resolutionState = "Resolved";
  conflict.resolution = resolution;
  conflict.resolvedAt = new Date().toISOString();
  return { conflict, resolvedBy: actorName };
}

// ---------------------------------------------------------------------------
// Deterministic selectors — every metric card and delivery-health
// indicator reads from these, never a hard-coded number.
// ---------------------------------------------------------------------------
export function computeLinkedProjectsCount(organizationId) {
  return queryExternalProjectLinksLocal(organizationId ? { organizationId } : {}).length;
}
export function computeUnlinkedWonDealsCount() {
  return queryWonDealsReadyForProject().length;
}
export function computeActiveProjectsCount(organizationId) {
  const links = queryExternalProjectLinksLocal(organizationId ? { organizationId } : {});
  return links.filter((l) => { const p = findProject(l.crmProjectId); return p?.status === "Active"; }).length;
}
export function computeProjectsPastTargetDate(organizationId) {
  const links = queryExternalProjectLinksLocal(organizationId ? { organizationId } : {});
  return links.filter((l) => { const p = findProject(l.crmProjectId); return p && p.dueDate && new Date(p.dueDate) < new Date() && p.status !== "Completed"; });
}
export function computeOverdueTasks() {
  return tasks.filter((t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "Done");
}
export function computeBlockedTasks() {
  return tasks.filter((t) => t.status === "Blocked" || WORK_ITEM_PREVIEWS.some((w) => w.crmTaskId === t._id && w.canonicalStatus === "Blocked"));
}
export function computeUnassignedTasks() {
  return tasks.filter((t) => !t.assignee);
}
export function computeMilestonesAtRisk() {
  const atRisk = [];
  projects.forEach((p) => (p.milestones || []).forEach((m) => {
    if (!m.completed && m.dueDate && new Date(m.dueDate) < daysFromNow(3) && new Date(m.dueDate) >= new Date()) atRisk.push({ projectId: p._id, milestone: m });
  }));
  return atRisk;
}
export function computeMilestonesOverdue() {
  const overdue = [];
  projects.forEach((p) => (p.milestones || []).forEach((m) => {
    if (!m.completed && m.dueDate && new Date(m.dueDate) < new Date()) overdue.push({ projectId: p._id, milestone: m });
  }));
  return overdue;
}
export function computeOpenCriticalIssues() {
  return DEVELOPMENT_ISSUES.filter((i) => i.canonicalPriority === "Urgent" && i.canonicalStatus !== "Done");
}
export function computePullRequestsAwaitingReview() {
  return CODE_REVIEWS.filter((r) => r.status === "Awaiting Review");
}
export function computeBuildsByStatus() {
  const groups = {};
  PIPELINE_RUNS.forEach((p) => { groups[p.status] = (groups[p.status] || 0) + 1; });
  return groups;
}
export function computeBuildSuccessRate() {
  if (PIPELINE_RUNS.length === 0) return null;
  const passed = PIPELINE_RUNS.filter((p) => p.status === "Passed").length;
  return Math.round((passed / PIPELINE_RUNS.length) * 100);
}
export function computeRepeatedBuildFailures() {
  const byRepo = {};
  PIPELINE_RUNS.filter((p) => p.status === "Failed").forEach((p) => { byRepo[p.repositoryId] = (byRepo[p.repositoryId] || 0) + 1; });
  return Object.entries(byRepo).filter(([, count]) => count >= 2).map(([repositoryId, count]) => ({ repositoryId, count }));
}
export function computeDeploymentsByStatus() {
  const groups = {};
  DEPLOYMENTS.forEach((d) => { groups[d.status] = (groups[d.status] || 0) + 1; });
  return groups;
}
export function computeDeploymentSuccessRate() {
  if (DEPLOYMENTS.length === 0) return null;
  const success = DEPLOYMENTS.filter((d) => d.status === "Successful").length;
  return Math.round((success / DEPLOYMENTS.length) * 100);
}
export function computeFailedDeployments() {
  return DEPLOYMENTS.filter((d) => d.status === "Failed");
}
export function computeFailedBuilds() {
  return PIPELINE_RUNS.filter((p) => p.status === "Failed");
}
export function computeReleasesWithoutLinkedProject() {
  return RELEASES.filter((r) => !r.crmProjectId);
}
export function computeStaleProviderData(hoursThreshold = 24) {
  const cutoff = Date.now() - hoursThreshold * 60 * 60 * 1000;
  return EXTERNAL_PROJECT_LINKS.filter((l) => !l.lastPreviewSyncAt || new Date(l.lastPreviewSyncAt).getTime() < cutoff);
}
export function computeMappingCompleteness() {
  const tables = [PROJECT_STATUS_MAPPINGS, TASK_STATUS_MAPPINGS, PRIORITY_MAPPINGS, WORK_ITEM_TYPE_MAPPINGS];
  const all = tables.flat();
  if (all.length === 0) return 100;
  const valid = all.filter((m) => m.validation === "Valid").length;
  return Math.round((valid / all.length) * 100);
}
export function computeOpenSyncConflicts(organizationId) {
  return querySyncConflictsLocal({ organizationId, resolutionState: "Open" });
}
export function computeExcessiveWorkInProgress(limit = 5) {
  const byAssignee = {};
  tasks.filter((t) => t.status === "In Progress").forEach((t) => { byAssignee[t.assignee || "Unassigned"] = (byAssignee[t.assignee || "Unassigned"] || 0) + 1; });
  return Object.entries(byAssignee).filter(([, count]) => count > limit).map(([assignee, count]) => ({ assignee, count }));
}
export function computeDependencyBlockingDelivery() {
  return WORK_ITEM_PREVIEWS.filter((w) => w.blockedByExternalId);
}
export function computeTasksByCanonicalStatus() {
  const groups = {};
  WorkItemStatusCanonical.forEach((s) => { groups[s] = 0; });
  WORK_ITEM_PREVIEWS.forEach((w) => { groups[w.canonicalStatus] = (groups[w.canonicalStatus] || 0) + 1; });
  return groups;
}
export function computeTasksByPriority() {
  const groups = {};
  PriorityCanonical.forEach((p) => { groups[p] = 0; });
  tasks.forEach((t) => { const c = TASK_PRIORITY_TO_CANONICAL[t.priority] || MAPPING_REVIEW_REQUIRED; groups[c] = (groups[c] || 0) + 1; });
  return groups;
}

// ---------------------------------------------------------------------------
// Delivery-health indicators — each returns what/why/affected/fields/
// calculation/action/approver/freshness. Never a single collapsed score.
// ---------------------------------------------------------------------------
function indicator({ id, label, detected, why, affected, fields, calculation, requiredAction, requiredApprover, freshness = new Date().toISOString() }) {
  return { id, label, detected, why, affected, fields, calculation, requiredAction, requiredApprover, freshness };
}

export function computeDeliveryHealthIndicators(organizationId) {
  const pastTarget = computeProjectsPastTargetDate(organizationId);
  const overdueTasks = computeOverdueTasks();
  const blockedTasks = computeBlockedTasks();
  const unassigned = computeUnassignedTasks();
  const atRiskMilestones = computeMilestonesAtRisk();
  const overdueMilestones = computeMilestonesOverdue();
  const failedBuilds = computeFailedBuilds();
  const repeatedFailures = computeRepeatedBuildFailures();
  const failedDeployments = computeFailedDeployments();
  const pendingDeployments = DEPLOYMENTS.filter((d) => d.status === "Pending Approval");
  const releasesNoProject = computeReleasesWithoutLinkedProject();
  const stale = computeStaleProviderData();
  const conflicts = computeOpenSyncConflicts(organizationId);
  const excessiveWip = computeExcessiveWorkInProgress();
  const dependencyBlocked = computeDependencyBlockingDelivery();
  const noOwner = projects.filter((p) => !p.owner);
  const noActivity = projects.filter((p) => { const link = findExternalProjectLinkByProjectId(p._id); return link && link.lastPreviewSyncAt && new Date(link.lastPreviewSyncAt) < daysAgo(7); });
  const noDueDate = tasks.filter((t) => !t.dueDate);
  const statusMismatch = PROJECT_SYNC_CONFLICTS.filter((c) => c.conflictType === "Project-status mismatch" && c.resolutionState === "Open");

  return [
    indicator({ id: "past_target_date", label: "Project past target date", detected: pastTarget.length > 0, why: "The Project's own due date has passed without a Completed status.", affected: pastTarget.map((l) => l.crmProjectId), fields: ["Project.dueDate", "Project.status"], calculation: "dueDate < now AND status != Completed", requiredAction: "Review and update the target date or close the Project.", requiredApprover: "Project Manager" }),
    indicator({ id: "missing_owner", label: "Project missing owner", detected: noOwner.length > 0, why: "No delivery owner is assigned.", affected: noOwner.map((p) => p._id), fields: ["Project.owner"], calculation: "owner is empty", requiredAction: "Assign a Project Manager.", requiredApprover: "Project Manager" }),
    indicator({ id: "no_recent_activity", label: "Project without recent activity", detected: noActivity.length > 0, why: "No preview synchronization in over 7 days.", affected: noActivity.map((p) => p._id), fields: ["ExternalProjectLink.lastPreviewSyncAt"], calculation: "lastPreviewSyncAt older than 7 days", requiredAction: "Run a preview synchronization or confirm the Project is intentionally paused.", requiredApprover: "Project Manager" }),
    indicator({ id: "overdue_task", label: "Overdue Task", detected: overdueTasks.length > 0, why: "The Task's due date has passed while still open.", affected: overdueTasks.map((t) => t._id), fields: ["Task.dueDate", "Task.status"], calculation: "dueDate < now AND status != Done", requiredAction: "Reassign, reschedule, or escalate the Task.", requiredApprover: "Project Manager" }),
    indicator({ id: "blocked_task", label: "Blocked Task", detected: blockedTasks.length > 0, why: "The Task or its linked work item is marked Blocked.", affected: blockedTasks.map((t) => t._id), fields: ["Task.status", "WorkItemPreview.canonicalStatus"], calculation: "status == Blocked", requiredAction: "Resolve the blocking dependency.", requiredApprover: "Project Manager" }),
    indicator({ id: "milestone_at_risk", label: "Milestone at risk", detected: atRiskMilestones.length > 0, why: "Due within 3 days and not yet completed.", affected: atRiskMilestones.map((m) => m.milestone._id), fields: ["Milestone.dueDate", "Milestone.completed"], calculation: "dueDate within 3 days AND completed == false", requiredAction: "Confirm delivery is on track or escalate.", requiredApprover: "Project Manager" }),
    indicator({ id: "milestone_overdue", label: "Milestone overdue", detected: overdueMilestones.length > 0, why: "Due date has passed and it is not completed.", affected: overdueMilestones.map((m) => m.milestone._id), fields: ["Milestone.dueDate", "Milestone.completed"], calculation: "dueDate < now AND completed == false", requiredAction: "Update the milestone or escalate.", requiredApprover: "Project Manager" }),
    indicator({ id: "task_no_assignee", label: "Task without assignee", detected: unassigned.length > 0, why: "No one is accountable for this Task.", affected: unassigned.map((t) => t._id), fields: ["Task.assignee"], calculation: "assignee is empty", requiredAction: "Assign an owner.", requiredApprover: "Project Manager" }),
    indicator({ id: "task_no_due_date", label: "Task without due date", detected: noDueDate.length > 0, why: "No due date makes overdue detection impossible.", affected: noDueDate.map((t) => t._id), fields: ["Task.dueDate"], calculation: "dueDate is empty", requiredAction: "Set a due date.", requiredApprover: "Project Manager" }),
    indicator({ id: "dependency_blocking", label: "Dependency blocking delivery", detected: dependencyBlocked.length > 0, why: "A work item is waiting on an unresolved external dependency.", affected: dependencyBlocked.map((w) => w.id), fields: ["WorkItemPreview.blockedByExternalId"], calculation: "blockedByExternalId is set", requiredAction: "Review and clear the dependency.", requiredApprover: "Project Manager" }),
    indicator({ id: "excessive_wip", label: "Excessive work in progress", detected: excessiveWip.length > 0, why: "More than 5 Tasks In Progress for one assignee at once.", affected: excessiveWip.map((e) => e.assignee), fields: ["Task.status", "Task.assignee"], calculation: "count(status == In Progress) per assignee > 5", requiredAction: "Rebalance workload.", requiredApprover: "Project Manager" }),
    indicator({ id: "failed_build", label: "Failed build", detected: failedBuilds.length > 0, why: "The most recent pipeline run did not pass.", affected: failedBuilds.map((b) => b.id), fields: ["PipelineRunReference.status"], calculation: "status == Failed", requiredAction: "Review the failed stage.", requiredApprover: "Developer" }),
    indicator({ id: "repeated_build_failure", label: "Repeated build failure", detected: repeatedFailures.length > 0, why: "2 or more failed runs for the same repository.", affected: repeatedFailures.map((r) => r.repositoryId), fields: ["PipelineRunReference.status", "PipelineRunReference.repositoryId"], calculation: "count(status == Failed) per repository >= 2", requiredAction: "Investigate the recurring failure.", requiredApprover: "Developer" }),
    indicator({ id: "failed_deployment", label: "Failed deployment", detected: failedDeployments.length > 0, why: "The deployment did not complete successfully.", affected: failedDeployments.map((d) => d.id), fields: ["DeploymentReference.status"], calculation: "status == Failed", requiredAction: "Review and remediate before retrying.", requiredApprover: "Project Manager" }),
    indicator({ id: "deployment_awaiting_approval", label: "Deployment awaiting approval", detected: pendingDeployments.length > 0, why: "A deployment is blocked on a required approval.", affected: pendingDeployments.map((d) => d.id), fields: ["DeploymentReference.approvalStatus"], calculation: "approvalStatus == Pending", requiredAction: "Obtain the required approval.", requiredApprover: "Project Manager" }),
    indicator({ id: "release_no_project", label: "Release without linked Project", detected: releasesNoProject.length > 0, why: "A release exists with no traceable delivery Project.", affected: releasesNoProject.map((r) => r.id), fields: ["ReleaseReference.crmProjectId"], calculation: "crmProjectId is empty", requiredAction: "Link the release to a Project.", requiredApprover: "Project Manager" }),
    indicator({ id: "status_mismatch", label: "Project status mismatch", detected: statusMismatch.length > 0, why: "The CRM Project status and the provider's status disagree.", affected: statusMismatch.map((c) => c.linkId), fields: ["ExternalProjectLink", "Project.status"], calculation: "open Project-status mismatch conflict exists", requiredAction: "Resolve the conflict on the Projects route.", requiredApprover: "Project Manager" }),
    indicator({ id: "stale_provider_data", label: "Stale provider data", detected: stale.length > 0, why: "No preview synchronization in over 24 hours.", affected: stale.map((l) => l.id), fields: ["ExternalProjectLink.lastPreviewSyncAt"], calculation: "lastPreviewSyncAt older than 24 hours (or never synced)", requiredAction: "Run a preview synchronization.", requiredApprover: "Project Manager" }),
    indicator({ id: "sync_conflict", label: "Synchronization conflict", detected: conflicts.length > 0, why: "An open conflict has not been reviewed.", affected: conflicts.map((c) => c.id), fields: ["ProjectSyncConflict.resolutionState"], calculation: "resolutionState == Open", requiredAction: "Review and resolve.", requiredApprover: "Project Manager" }),
  ];
}

// ---------------------------------------------------------------------------
// Overview metrics.
// ---------------------------------------------------------------------------
const PHASE4_PROVIDER_KEYS = new Set(PHASE4_PROVIDERS.map((p) => p.key));

export function computeProjectsDevelopmentOverviewMetrics({ organizationId, connections = [] } = {}) {
  const previewConnectedProviders = connections.filter(
    (c) => PHASE4_PROVIDER_KEYS.has(c.providerKey) && c.status === "Preview Connected" && (!organizationId || c.organizationId === organizationId)
  ).length;
  const links = queryExternalProjectLinksLocal(organizationId ? { organizationId } : {});
  return {
    previewConnectedProviders,
    linkedProjects: links.length,
    unlinkedExternalProjects: queryWonDealsReadyForProject().length,
    activeWorkItems: WORK_ITEM_PREVIEWS.filter((w) => w.canonicalStatus === "In Progress").length,
    overdueTasks: computeOverdueTasks().length,
    blockedTasks: computeBlockedTasks().length,
    milestonesAtRisk: computeMilestonesAtRisk().length,
    openCriticalIssues: computeOpenCriticalIssues().length,
    pullRequestsAwaitingReview: computePullRequestsAwaitingReview().length,
    failedBuilds: computeFailedBuilds().length,
    failedDeployments: computeFailedDeployments().length,
    synchronizationConflicts: computeOpenSyncConflicts(organizationId).length,
  };
}
