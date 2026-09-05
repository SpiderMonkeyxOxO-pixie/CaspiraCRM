import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../services/auditService.js";

function slugify(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "org";
}

async function uniqueSlug(name) {
  const base = slugify(name);
  let slug = base;
  let suffix = 1;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    slug = `${base}-${++suffix}`;
  }
  return slug;
}

// Every authenticated user may create an organization — this is the
// legitimate bootstrap path for the very first Organization Administrator
// on a new org (distinct from, and not a loophole around, the rule that an
// ORDINARY INVITATION can never grant that role on an EXISTING org). The
// creator becomes that org's Admin, nothing more.
export async function createOrganization(req, res) {
  const { name, settings } = req.body;
  if (!name?.trim()) return res.status(400).json({ code: "VALIDATION_ERROR", message: "Organization name is required." });

  const adminRole = await prisma.role.findUnique({ where: { key: "admin" } });
  if (!adminRole) return res.status(500).json({ code: "SERVER_MISCONFIGURED", message: "Default organization role is not seeded." });

  const slug = await uniqueSlug(name);
  const organization = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: name.trim(), slug, createdByUserId: req.user.id, settings: settings || {} },
    });
    const membership = await tx.organizationMembership.create({
      data: { organizationId: org.id, userId: req.user.id, status: "Active", joinedAt: new Date() },
    });
    await tx.membershipRole.create({ data: { membershipId: membership.id, roleId: adminRole.id, assignedByUserId: req.user.id } });
    return org;
  });

  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, organizationId: organization.id, action: "organization.created", targetType: "Organization", targetId: organization.id, result: "Success" });
  res.status(201).json({ organization: toApi(organization) });
}

// Only organizations the caller actually belongs to (or every organization,
// for System Owner) — never a global list an ordinary member can browse.
export async function listOrganizations(req, res) {
  if (req.user.role === "Super-Admin") {
    const organizations = await prisma.organization.findMany({ orderBy: { createdAt: "desc" } });
    return res.json({ organizations: toApi(organizations) });
  }
  const memberships = await prisma.organizationMembership.findMany({
    where: { userId: req.user.id, status: { in: ["Active", "Invited"] } },
    include: { organization: true },
  });
  res.json({ organizations: toApi(memberships.map((m) => m.organization)) });
}

export async function getOrganization(req, res) {
  const organization = await prisma.organization.findUnique({ where: { id: req.params.organizationId } });
  if (!organization) return res.status(404).json({ code: "NOT_FOUND", message: "Not found." });
  res.json({ organization: toApi(organization) });
}

export async function updateOrganization(req, res) {
  const { name, settings, status } = req.body;
  const before = await prisma.organization.findUnique({ where: { id: req.params.organizationId } });
  if (!before) return res.status(404).json({ code: "NOT_FOUND", message: "Not found." });

  // Suspending/archiving an organization is a system-level capability, not
  // an ordinary Organization Administrator one — an org admin scoped to
  // their own org must never be able to take their own org offline via a
  // field they're otherwise allowed to PATCH.
  const data = { ...(name?.trim() ? { name: name.trim() } : {}), ...(settings ? { settings } : {}) };
  if (status && status !== before.status) {
    if (!req.isSystemOwnerOverride) {
      return res.status(403).json({ code: "FORBIDDEN", message: "Only a System Owner may change organization status." });
    }
    data.status = status;
  }

  const organization = await prisma.organization.update({ where: { id: req.params.organizationId }, data });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, organizationId: organization.id, action: "organization.updated", targetType: "Organization", targetId: organization.id, result: "Success", before: toApi(before), after: toApi(organization) });
  res.json({ organization: toApi(organization) });
}
