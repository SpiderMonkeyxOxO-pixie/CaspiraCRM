import prisma from "../../lib/prisma.js";

const RECENT_DAYS_FOR_INACTIVITY = 30;

export async function crmContactSummary(organizationId, extraWhere = {}) {
  const where = { organizationId, archived: false, ...extraWhere };
  const [total, byLifecycleRaw, missingOwner, missingContactInfo, doNotContactCount] = await Promise.all([
    prisma.contact.count({ where }),
    prisma.contact.groupBy({ by: ["lifecycleStage"], where, _count: true }),
    prisma.contact.count({ where: { ...where, ownerMembershipId: null } }),
    prisma.contact.count({ where: { ...where, email: null, phone: null } }),
    prisma.contact.count({ where: { ...where, doNotContact: true } }),
  ]);
  return {
    total,
    byLifecycleStage: Object.fromEntries(byLifecycleRaw.filter((r) => r.lifecycleStage).map((r) => [r.lifecycleStage, r._count])),
    missingOwner, missingContactInfo, doNotContactCount,
  };
}

export async function crmCompanySummary(organizationId, extraWhere = {}) {
  const where = { organizationId, archived: false, ...extraWhere };
  const [total, byLifecycleRaw, missingOwner] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.groupBy({ by: ["lifecycleStage"], where, _count: true }),
    prisma.company.count({ where: { ...where, ownerMembershipId: null } }),
  ]);

  // "Companies with no primary Contact" and "without recent activity" are
  // computed from the real relationship/activity tables, never a stored
  // counter (per the spec's explicit "do not store derived values"
  // instruction).
  const companiesWithPrimary = await prisma.companyContactRelationship.findMany({
    where: { isPrimaryContact: true, endDate: null, company: { organizationId, archived: false, ...extraWhere } },
    select: { companyId: true }, distinct: ["companyId"],
  });
  const withoutPrimaryContact = total - companiesWithPrimary.length;

  const cutoff = new Date(Date.now() - RECENT_DAYS_FOR_INACTIVITY * 24 * 60 * 60 * 1000);
  const companiesWithRecentActivity = await prisma.activity.findMany({
    where: { companyId: { not: null }, createdAt: { gte: cutoff }, company: { organizationId, archived: false, ...extraWhere } },
    select: { companyId: true }, distinct: ["companyId"],
  });
  const withoutRecentActivity = total - companiesWithRecentActivity.length;

  return {
    total,
    byLifecycleStage: Object.fromEntries(byLifecycleRaw.filter((r) => r.lifecycleStage).map((r) => [r.lifecycleStage, r._count])),
    missingOwner, withoutPrimaryContact, withoutRecentActivity,
  };
}

const MODEL_SELECT = {
  contact: { id: true, name: true, lifecycleStage: true, createdAt: true, updatedAt: true },
  company: { id: true, name: true, lifecycleStage: true, createdAt: true, updatedAt: true },
};

export async function recentlyCreated(model, organizationId, extraWhere = {}, take = 10) {
  return prisma[model].findMany({ where: { organizationId, archived: false, ...extraWhere }, orderBy: { createdAt: "desc" }, take, select: MODEL_SELECT[model] });
}

export async function recentlyUpdated(model, organizationId, extraWhere = {}, take = 10) {
  return prisma[model].findMany({ where: { organizationId, archived: false, ...extraWhere }, orderBy: { updatedAt: "desc" }, take, select: MODEL_SELECT[model] });
}
