// Idempotent Projects fixture import — LOCAL DEVELOPMENT ONLY, never
// production. Same approach as the CRM, Sales and Support fixture imports:
// a small hand-curated dataset in the SHAPE of the frontend's
// mockProjectsData.js (its statuses, priorities, milestone and task
// fields) — not a port of its faker-random generator, which has no stable
// IDs to preserve.
//
// Stable keys: template, portfolio and project by name; tasks by title
// within the project. Re-running creates nothing twice. Members come from
// the organization's active memberships; the company from its Phase 2
// records. Dependencies are checked for loops before they're created.
//
// Usage: PROJECT_FIXTURE_ORG_ID=<org id> node prisma/seedProjectFixtures.js
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { nextDocumentNumber } from "../src/services/sales/documentNumberService.js";
import { ensureDefaultBoard } from "../src/services/projects/boardService.js";
import { validateTemplateContent } from "../src/services/projects/templateService.js";
import { computeProgress } from "../src/services/projects/progressService.js";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to import Project fixtures in production.");
  process.exit(1);
}
const organizationId = process.env.PROJECT_FIXTURE_ORG_ID;
if (!organizationId) {
  console.error("Set PROJECT_FIXTURE_ORG_ID to the organization to import into.");
  process.exit(1);
}

const report = { created: {}, skipped: {}, warnings: [] };
const tally = (kind, created) => { const b = created ? report.created : report.skipped; b[kind] = (b[kind] || 0) + 1; };

const TEMPLATE_CONTENT = {
  phases: [{ name: "Discovery" }, { name: "Delivery" }],
  milestones: [{ name: "Kickoff complete", offsetDays: 7, phase: "Discovery", customerVisible: true }, { name: "Go-live", offsetDays: 45, phase: "Delivery", acceptanceRequired: true, customerVisible: true }],
  tasks: [
    { key: "kick", title: "Kickoff meeting", phase: "Discovery", offsetDays: 3, estimateMinutes: 120, checklist: ["Agenda sent", "Stakeholders confirmed"] },
    { key: "req", title: "Gather requirements", phase: "Discovery", offsetDays: 10, estimateMinutes: 480 },
    { key: "cfg", title: "Configure workspace", phase: "Delivery", offsetDays: 25, estimateMinutes: 960 },
    { key: "uat", title: "User acceptance testing", phase: "Delivery", offsetDays: 40, estimateMinutes: 600 },
  ],
  dependencies: [{ from: "kick", to: "req" }, { from: "req", to: "cfg" }, { from: "cfg", to: "uat" }],
  roles: ["Project Manager", "Contributor", "Reviewer"],
};

async function main() {
  const error = validateTemplateContent(TEMPLATE_CONTENT);
  if (error) throw new Error(`Fixture template is invalid: ${error}`);
  const memberships = await prisma.organizationMembership.findMany({ where: { organizationId, status: "Active" }, orderBy: { createdAt: "asc" }, take: 3 });
  if (!memberships.length) throw new Error("The organization has no active members.");
  const [manager, contributor = manager, reviewer = manager] = memberships;
  const company = await prisma.company.findFirst({ where: { organizationId }, orderBy: { createdAt: "asc" } });
  if (!company) report.warnings.push("No companies — the fixture project has no customer (run seedCrmFixtures.js first for a fuller set).");

  let template = await prisma.projectTemplate.findFirst({ where: { organizationId, name: "Fixture — Customer onboarding" } });
  if (!template) {
    template = await prisma.projectTemplate.create({ data: { organizationId, name: "Fixture — Customer onboarding", description: "Standard onboarding plan." } });
    const v = await prisma.projectTemplateVersion.create({ data: { organizationId, templateId: template.id, versionNumber: 1, content: TEMPLATE_CONTENT } });
    template = await prisma.projectTemplate.update({ where: { id: template.id }, data: { currentVersionId: v.id } });
    tally("templates", true);
  } else tally("templates", false);

  let portfolio = await prisma.projectPortfolio.findFirst({ where: { organizationId, name: "Fixture — Customer delivery" } });
  if (!portfolio) { portfolio = await prisma.projectPortfolio.create({ data: { organizationId, name: "Fixture — Customer delivery", ownerMembershipId: manager.id } }); tally("portfolios", true); } else tally("portfolios", false);

  const name = "[Fixture] Acme onboarding";
  let project = await prisma.project.findFirst({ where: { organizationId, name } });
  if (project) {
    tally("projects", false);
  } else {
    const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const day = (n) => new Date(start.getTime() + n * 86400000);
    await prisma.$transaction(async (tx) => {
      const projectNumber = await nextDocumentNumber(tx, organizationId, "Project");
      project = await tx.project.create({
        data: {
          organizationId, projectNumber, name, status: "Active", priority: "High", portfolioId: portfolio.id, companyId: company?.id || null, customerVisible: !!company,
          customerSummary: "Onboarding is on schedule.", startDate: start, dueDate: day(45), actualStartDate: start, ownerMembershipId: manager.id,
          templateId: template.id, templateVersionNumber: 1, plannedEffortMinutes: 2160, createdByMembershipId: manager.id,
        },
      });
      for (const [m, role] of [[manager, "Project Manager"], [contributor, "Contributor"], [reviewer, "Reviewer"]]) {
        await tx.projectMember.upsert({ where: { projectId_membershipId: { projectId: project.id, membershipId: m.id } }, update: {}, create: { organizationId, projectId: project.id, membershipId: m.id, role, allocationPercent: role === "Contributor" ? 60 : 20 } });
      }
      const board = await ensureDefaultBoard(tx, project);
      const col = (name) => board.columns.find((c) => c.name === name);
      const phases = {};
      for (const [i, ph] of TEMPLATE_CONTENT.phases.entries()) phases[ph.name] = (await tx.projectPhase.create({ data: { organizationId, projectId: project.id, name: ph.name, displayOrder: i, status: i === 0 ? "Completed" : "In Progress" } })).id;
      for (const m of TEMPLATE_CONTENT.milestones) {
        await tx.milestone.create({ data: { organizationId, projectId: project.id, name: m.name, dueDate: day(m.offsetDays), phaseId: phases[m.phase], acceptanceRequired: !!m.acceptanceRequired, customerVisible: !!m.customerVisible, status: m.offsetDays <= 7 ? "Achieved" : "Planned", completed: m.offsetDays <= 7 } });
      }
      const states = { kick: "Done", req: "Done", cfg: "In Progress", uat: "To Do" };
      const ids = {};
      for (const t of TEMPLATE_CONTENT.tasks) {
        const c = col(states[t.key]);
        const taskNumber = await nextDocumentNumber(tx, organizationId, "Task");
        const task = await tx.task.create({
          data: {
            organizationId, projectId: project.id, taskNumber, title: t.title, phaseId: phases[t.phase], dueDate: day(t.offsetDays), estimatedMinutes: t.estimateMinutes, estimateHours: t.estimateMinutes / 60,
            boardId: board.id, columnId: c.id, status: c.name, statusCategory: c.category, completedAt: c.category === "Completed" ? day(t.offsetDays) : null,
            assigneeMembershipId: contributor.id, createdByMembershipId: manager.id, reporterMembershipId: manager.id,
          },
        });
        await tx.taskAssignee.create({ data: { organizationId, taskId: task.id, membershipId: contributor.id, role: "Owner", assignedByMembershipId: manager.id } });
        for (const [i, title] of (t.checklist || []).entries()) await tx.taskChecklistItem.create({ data: { organizationId, taskId: task.id, title, displayOrder: i, completed: true } });
        ids[t.key] = task.id;
      }
      for (const d of TEMPLATE_CONTENT.dependencies) await tx.taskDependency.create({ data: { organizationId, projectId: project.id, predecessorId: ids[d.from], successorId: ids[d.to] } });
      await tx.taskTimeEntry.create({ data: { organizationId, projectId: project.id, taskId: ids.kick, authorMembershipId: contributor.id, workDate: day(3), durationMinutes: 120, hours: 2, status: "Approved", approvedByMembershipId: manager.id, approvedAt: day(4), submittedAt: day(3) } });
      await tx.task.update({ where: { id: ids.kick }, data: { loggedHours: 2 } });
      await tx.projectRisk.create({ data: { organizationId, projectId: project.id, title: "Customer data export may be late", probabilityLevel: "Medium", impactLevel: "High", responseStrategy: "Mitigate", mitigationPlan: "Agree an export date at kickoff.", ownerMembershipId: manager.id } });
      await tx.projectIssue.create({ data: { organizationId, projectId: project.id, title: "SSO test tenant unavailable", severity: "Moderate", relatedTaskId: ids.cfg, ownerMembershipId: contributor.id, status: "Investigating" } });
      const deliverableNumber = await nextDocumentNumber(tx, organizationId, "Deliverable");
      await tx.deliverable.create({ data: { organizationId, projectId: project.id, deliverableNumber, name: "Configured workspace", customerVisible: !!company, ownerMembershipId: contributor.id, reviewerMembershipId: reviewer.id, status: "In Progress", dueDate: day(40), acceptanceCriteria: "All onboarding checklist items pass UAT." } });
      await tx.projectActivity.create({ data: { organizationId, projectId: project.id, eventType: "Project Created", actorType: "System", reason: "Fixture import", snapshot: { projectNumber } } });
    });
    const tasks = await prisma.task.findMany({ where: { projectId: project.id } });
    const milestones = await prisma.milestone.findMany({ where: { projectId: project.id } });
    const progress = computeProgress(project, tasks, milestones);
    await prisma.projectBaseline.create({
      data: { organizationId, projectId: project.id, baselineNumber: 1, reason: "Fixture import — initial plan", snapshot: { project: { startDate: project.startDate, dueDate: project.dueDate, plannedEffortMinutes: project.plannedEffortMinutes }, tasks: tasks.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, estimatedMinutes: t.estimatedMinutes })), progress } },
    });
    tally("projects", true);
    report.recalculated = { progress: progress.basis };
  }

  console.log("Project fixture import report:");
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => { console.error("Project fixture import failed:", err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
