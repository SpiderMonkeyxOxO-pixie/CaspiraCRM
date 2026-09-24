// Backend Phase 12 — conformed dimensions. Owners and companies are slowly
// changing (type 2): when a tracked attribute changes (department, team,
// status, industry…) the current version is closed and a new one opened, so
// historical ownership and classification stay explainable. Lookup
// dimensions (stage, lead source, currency, queue, contract type, payment
// method, AI provider/model, project) keep one current version.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";

const hash = (v) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");

// entries: [{ type, sourceId, label, attributes, sourceUpdatedAt }]
export async function upsertDimensions(organizationId, entries, now = new Date()) {
  const unique = [...new Map(entries.filter((e) => e.sourceId).map((e) => [`${e.type}:${e.sourceId}`, e])).values()];
  if (!unique.length) return { created: 0, versioned: 0 };
  const existing = await prisma.analyticsDimension.findMany({ where: { organizationId, OR: unique.map((e) => ({ type: e.type, sourceId: e.sourceId })) } });
  const byKey = Object.fromEntries(existing.map((d) => [`${d.type}:${d.sourceId}`, d]));
  const currentVersions = existing.length ? await prisma.analyticsDimensionVersion.findMany({ where: { dimensionId: { in: existing.map((d) => d.id) }, isCurrent: true } }) : [];
  const verBy = Object.fromEntries(currentVersions.map((v) => [v.dimensionId, v]));
  let created = 0; let versioned = 0;
  for (const e of unique) {
    const h = hash({ label: e.label, ...e.attributes });
    const dim = byKey[`${e.type}:${e.sourceId}`];
    if (!dim) {
      const d = await prisma.analyticsDimension.create({ data: { organizationId, type: e.type, sourceId: e.sourceId, label: String(e.label || e.sourceId).slice(0, 200) } });
      const v = await prisma.analyticsDimensionVersion.create({ data: { dimensionId: d.id, organizationId, attributes: e.attributes || {}, attributesHash: h, effectiveFrom: e.sourceUpdatedAt || now, isDeleted: !!e.deleted, sourceUpdatedAt: e.sourceUpdatedAt || null } });
      await prisma.analyticsDimension.update({ where: { id: d.id }, data: { currentVersionId: v.id } });
      created += 1;
      continue;
    }
    const cur = verBy[dim.id];
    if (cur && cur.attributesHash === h && cur.isDeleted === !!e.deleted) continue;
    const from = e.sourceUpdatedAt && (!cur || e.sourceUpdatedAt > cur.effectiveFrom) ? e.sourceUpdatedAt : now;
    if (cur) await prisma.analyticsDimensionVersion.update({ where: { id: cur.id }, data: { isCurrent: false, effectiveTo: from, warehouseUpdatedAt: now } });
    const v = await prisma.analyticsDimensionVersion.create({ data: { dimensionId: dim.id, organizationId, attributes: e.attributes || {}, attributesHash: h, effectiveFrom: from, isDeleted: !!e.deleted, sourceUpdatedAt: e.sourceUpdatedAt || null } });
    await prisma.analyticsDimension.update({ where: { id: dim.id }, data: { currentVersionId: v.id, label: String(e.label || dim.label).slice(0, 200) } });
    versioned += 1;
  }
  return { created, versioned };
}

// Builds dimension entries for the keys referenced by a batch of fact rows.
export async function dimensionEntriesFor(organizationId, facts) {
  const pick = (k) => [...new Set(facts.map((f) => f[k]).filter(Boolean))];
  const owners = [...new Set([...pick("ownerMembershipId"), ...pick("assignedMembershipId"), ...pick("assigneeMembershipId")])];
  const companies = pick("companyId");
  const projects = pick("projectId");
  const [members, comps, projs] = await Promise.all([
    owners.length ? prisma.organizationMembership.findMany({ where: { id: { in: owners } }, include: { user: { select: { username: true, name: true, fullName: true, department: true, team: true } }, roles: { include: { role: { select: { key: true } } } } } }) : [],
    companies.length ? prisma.company.findMany({ where: { id: { in: companies } }, select: { id: true, name: true, industry: true, country: true, updatedAt: true, archivedAt: true } }).catch(() => []) : [],
    projects.length ? prisma.project.findMany({ where: { id: { in: projects } }, select: { id: true, name: true, status: true, updatedAt: true } }) : [],
  ]);
  const entries = [
    ...members.map((m) => ({ type: "owner", sourceId: m.id, label: m.user?.fullName || m.user?.name || m.user?.username || m.id, attributes: { department: m.user?.department || null, team: m.user?.team || null, status: m.status, roles: m.roles.map((r) => r.role.key).sort() }, sourceUpdatedAt: m.updatedAt, deleted: m.status !== "Active" })),
    ...comps.map((c) => ({ type: "company", sourceId: c.id, label: c.name, attributes: { industry: c.industry || null, country: c.country || null }, sourceUpdatedAt: c.updatedAt, deleted: !!c.archivedAt })),
    ...projs.map((p) => ({ type: "project", sourceId: p.id, label: p.name, attributes: { status: p.status }, sourceUpdatedAt: p.updatedAt })),
    ...pick("currency").map((c) => ({ type: "currency", sourceId: c, label: c, attributes: {} })),
    ...pick("source").map((s) => ({ type: "lead_source", sourceId: s, label: s, attributes: {} })),
    ...pick("contractType").map((s) => ({ type: "contract_type", sourceId: s, label: s, attributes: {} })),
    ...pick("method").map((s) => ({ type: "payment_method", sourceId: s, label: s, attributes: {} })),
    ...pick("queueId").map((s) => ({ type: "support_queue", sourceId: s, label: s, attributes: {} })),
    ...pick("providerKey").map((s) => ({ type: "ai_provider", sourceId: s, label: s, attributes: {} })),
    ...pick("modelId").map((s) => ({ type: "ai_model", sourceId: s, label: s, attributes: {} })),
    ...pick("toStage").map((s) => ({ type: "stage", sourceId: s, label: s, attributes: {} })),
    ...pick("country").map((s) => ({ type: "country", sourceId: s, label: s, attributes: {} })),
  ];
  return entries;
}
