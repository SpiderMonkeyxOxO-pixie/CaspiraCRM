import prisma from "../../lib/prisma.js";

// Deterministic, typed, numeric — never natural-language, never an LLM
// call. Every count here is computed from a query that already has the
// organization scope applied (and, where the caller's role scope is
// narrower than the whole organization, that narrower `where` clause too)
// — never "query everything, then filter/hide in the response."

export async function leadSummary(organizationId, extraWhere = {}) {
  const where = { organizationId, archived: false, ...extraWhere };
  const [total, byStatusRaw, converted, missingOwner] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.groupBy({ by: ["status"], where, _count: true }),
    prisma.lead.count({ where: { ...where, status: "Converted" } }),
    prisma.lead.count({ where: { ...where, ownerMembershipId: null } }),
  ]);
  const byLifecycleRaw = await prisma.lead.groupBy({ by: ["lifecycleStage"], where, _count: true });

  const byStatus = Object.fromEntries(byStatusRaw.map((r) => [r.status, r._count]));
  const byLifecycleStage = Object.fromEntries(byLifecycleRaw.filter((r) => r.lifecycleStage).map((r) => [r.lifecycleStage, r._count]));
  const conversionRate = total > 0 ? Number((converted / total).toFixed(4)) : 0;

  return { total, byStatus, byLifecycleStage, converted, conversionRate, missingOwner };
}

export async function recentlyCreatedLeads(organizationId, extraWhere = {}, take = 10) {
  return prisma.lead.findMany({ where: { organizationId, archived: false, ...extraWhere }, orderBy: { createdAt: "desc" }, take, select: { id: true, name: true, companyName: true, status: true, createdAt: true } });
}

export async function recentlyUpdatedLeads(organizationId, extraWhere = {}, take = 10) {
  return prisma.lead.findMany({ where: { organizationId, archived: false, ...extraWhere }, orderBy: { updatedAt: "desc" }, take, select: { id: true, name: true, companyName: true, status: true, updatedAt: true } });
}

export async function activitySummary(organizationId, extraWhere = {}) {
  const where = { organizationId, ...extraWhere };
  const now = new Date();
  const [total, dueCount, overdueCount, completedCount, followUpCount] = await Promise.all([
    prisma.activity.count({ where }),
    prisma.activity.count({ where: { ...where, status: { notIn: ["Completed", "Cancelled"] }, dueDate: { not: null } } }),
    prisma.activity.count({ where: { ...where, status: { notIn: ["Completed", "Cancelled"] }, dueDate: { lt: now } } }),
    prisma.activity.count({ where: { ...where, status: "Completed" } }),
    prisma.activity.count({ where: { ...where, followUpRequired: true, status: { not: "Completed" } } }),
  ]);
  return { total, due: dueCount, overdue: overdueCount, completed: completedCount, requiringFollowUp: followUpCount };
}
