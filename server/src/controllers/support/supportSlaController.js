// Backend Phase 4 — SLA configuration: business-hours calendars, versioned
// SLA policies, Support Entitlements, and the manual entitlement override
// on a ticket.
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { validateCalendar, isValidTimeZone } from "../../services/support/businessHours.js";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "../../services/support/ticketLifecycleService.js";
import { contractGrantsSupport } from "../../services/support/slaService.js";
import { ticketScopeWhere } from "../../services/support/ticketService.js";
import { sanitizeText, invalid, notFound, versionConflict, staleVersion, audit, ticketEvent } from "../../services/support/supportCommon.js";

const who = (req) => req.membership?.id || null;
const text = (v, max) => (typeof v === "string" && v.trim() ? sanitizeText(v, { max }) : null);
const MAX_TARGET_MINUTES = 60 * 24 * 365;
const CHANNELS = ["Email", "Phone", "Chat", "Portal", "Manual", "Internal"];

function parseDate(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === "") return required ? { error: `${field} is required.` } : { value: null };
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? { error: `${field} must be a valid date.` } : { value: d };
}

// ---------------------------------------------------------------- Business hours

export async function listCalendars(req, res) {
  const calendars = await prisma.businessHoursCalendar.findMany({ where: { organizationId: req.organizationId }, orderBy: { name: "asc" } });
  res.json({ calendars: toApi(calendars) });
}

function calendarFields(body, existing) {
  const out = {};
  if (!existing || "name" in body) {
    const name = text(body.name, 120);
    if (!name) return { error: "name is required." };
    out.name = name;
  }
  const timeZone = "timeZone" in body ? body.timeZone : existing?.timeZone;
  const workingHours = "workingHours" in body ? body.workingHours : existing?.workingHours;
  const holidays = "holidays" in body ? body.holidays : existing?.holidays || [];
  const error = validateCalendar({ timeZone, workingHours, holidays });
  if (error) return { error };
  Object.assign(out, { timeZone, workingHours, holidays: holidays.map((h) => ({ date: h.date, name: text(h.name, 120) })) });
  for (const f of ["effectiveFrom", "effectiveTo"]) {
    if (f in body) {
      const d = parseDate(body[f], f);
      if (d.error) return { error: d.error };
      out[f] = d.value;
    }
  }
  if (out.effectiveFrom && out.effectiveTo && out.effectiveTo < out.effectiveFrom) return { error: "effectiveTo can't be before effectiveFrom." };
  if ("active" in body) out.active = Boolean(body.active);
  return { data: out };
}

export async function createCalendar(req, res) {
  const { data, error } = calendarFields(req.body, null);
  if (error) return invalid(res, error);
  if (await prisma.businessHoursCalendar.findFirst({ where: { organizationId: req.organizationId, name: data.name } })) return invalid(res, `A calendar named "${data.name}" already exists.`);
  const calendar = await prisma.businessHoursCalendar.create({ data: { ...data, organizationId: req.organizationId } });
  await audit(req, "support.business_hours.created", "BusinessHoursCalendar", calendar.id);
  res.status(201).json({ calendar: toApi(calendar) });
}

// Editing a calendar never changes tickets already running: each SLA policy
// version keeps a snapshot of the calendar it was created with.
export async function updateCalendar(req, res) {
  const existing = await prisma.businessHoursCalendar.findFirst({ where: { id: req.params.calendarId, organizationId: req.organizationId } });
  if (!existing) return notFound(res, "Calendar");
  if (staleVersion(req.body, existing)) return versionConflict(res, "calendar");
  const { data, error } = calendarFields(req.body, existing);
  if (error) return invalid(res, error);
  const calendar = await prisma.businessHoursCalendar.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } });
  await audit(req, "support.business_hours.updated", "BusinessHoursCalendar", calendar.id);
  res.json({ calendar: toApi(calendar) });
}

// ---------------------------------------------------------------- SLA policies

// targets: { Urgent: { firstResponseMinutes, nextResponseMinutes?, resolutionMinutes }, ... }
// Every priority needs a first-response and a resolution target, in minutes.
function validateTargets(targets) {
  if (!targets || typeof targets !== "object") return "targets are required.";
  for (const p of TICKET_PRIORITIES) {
    const t = targets[p];
    if (!t) return `targets.${p} is required.`;
    for (const key of ["firstResponseMinutes", "resolutionMinutes", "nextResponseMinutes"]) {
      if (key === "nextResponseMinutes" && (t[key] === undefined || t[key] === null)) continue;
      const v = t[key];
      if (!Number.isInteger(v) || v < 1 || v > MAX_TARGET_MINUTES) return `targets.${p}.${key} must be a whole number of minutes from 1 to ${MAX_TARGET_MINUTES}.`;
    }
    if (t.resolutionMinutes < t.firstResponseMinutes) return `targets.${p}: resolution can't be shorter than first response.`;
  }
  const extra = Object.keys(targets).find((k) => !TICKET_PRIORITIES.includes(k));
  if (extra) return `Unknown priority "${extra}" in targets.`;
  return null;
}

async function versionData(req, body) {
  const error = validateTargets(body.targets);
  if (error) return { error };
  const businessHours = Boolean(body.businessHours);
  let calendar = null;
  if (businessHours) {
    calendar = body.calendarId && (await prisma.businessHoursCalendar.findFirst({ where: { id: body.calendarId, organizationId: req.organizationId, active: true } }));
    if (!calendar) return { error: "A business-hours policy needs an active calendar from this organization (calendarId)." };
  }
  const pauseStatuses = body.pauseStatuses === undefined ? ["Waiting for Customer"] : body.pauseStatuses;
  if (!Array.isArray(pauseStatuses) || pauseStatuses.some((s) => !TICKET_STATUSES.includes(s) || ["Resolved", "Closed", "Cancelled"].includes(s))) {
    return { error: "pauseStatuses must list working ticket statuses." };
  }
  const warningPercent = body.warningPercent === undefined ? 80 : Number(body.warningPercent);
  if (!Number.isInteger(warningPercent) || warningPercent < 1 || warningPercent > 99) return { error: "warningPercent must be a whole number from 1 to 99." };
  const timeZone = calendar?.timeZone || body.timeZone || "UTC";
  if (!isValidTimeZone(timeZone)) return { error: "timeZone must be a valid IANA time zone." };
  const effectiveFrom = parseDate(body.effectiveFrom, "effectiveFrom");
  if (effectiveFrom.error) return { error: effectiveFrom.error };
  return {
    data: {
      businessHours, calendarId: calendar?.id || null, timeZone, targets: body.targets, pauseStatuses, warningPercent,
      // Frozen copy: later calendar edits never change this version's maths.
      calendarSnapshot: calendar ? { timeZone: calendar.timeZone, workingHours: calendar.workingHours, holidays: calendar.holidays, calendarId: calendar.id, calendarVersion: calendar.version } : null,
      effectiveFrom: effectiveFrom.value || new Date(),
    },
  };
}

const POLICY_INCLUDE = { versions: { orderBy: { versionNumber: "desc" } } };

export async function listPolicies(req, res) {
  const where = { organizationId: req.organizationId, ...(req.query.includeArchived === "true" ? {} : { archivedAt: null }) };
  const policies = await prisma.slaPolicy.findMany({ where, include: POLICY_INCLUDE, orderBy: { name: "asc" } });
  res.json({ policies: toApi(policies) });
}

export async function getPolicy(req, res) {
  const policy = await prisma.slaPolicy.findFirst({ where: { id: req.params.policyId, organizationId: req.organizationId }, include: POLICY_INCLUDE });
  if (!policy) return notFound(res, "SLA policy");
  res.json({ policy: toApi(policy) });
}

export async function createPolicy(req, res) {
  const name = text(req.body.name, 120);
  if (!name) return invalid(res, "name is required.");
  if (await prisma.slaPolicy.findFirst({ where: { organizationId: req.organizationId, name } })) return invalid(res, `An SLA policy named "${name}" already exists.`);
  const { data, error } = await versionData(req, req.body);
  if (error) return invalid(res, error);
  const policy = await prisma.$transaction(async (tx) => {
    const p = await tx.slaPolicy.create({ data: { organizationId: req.organizationId, name, description: text(req.body.description, 1000), createdByMembershipId: who(req), updatedByMembershipId: who(req) } });
    const v = await tx.slaPolicyVersion.create({ data: { ...data, organizationId: req.organizationId, policyId: p.id, versionNumber: 1, createdByMembershipId: who(req) } });
    return tx.slaPolicy.update({ where: { id: p.id }, data: { currentVersionId: v.id }, include: POLICY_INCLUDE });
  });
  await audit(req, "support.sla_policy.created", "SlaPolicy", policy.id);
  res.status(201).json({ policy: toApi(policy) });
}

// Only the name, description and active flag change in place. Rules change
// through a new version — existing tickets keep the version they started with.
export async function updatePolicy(req, res) {
  const existing = await prisma.slaPolicy.findFirst({ where: { id: req.params.policyId, organizationId: req.organizationId } });
  if (!existing) return notFound(res, "SLA policy");
  if (existing.archivedAt) return invalid(res, "An archived policy can't be edited.");
  if (staleVersion(req.body, existing)) return versionConflict(res, "SLA policy");
  if (["targets", "businessHours", "calendarId", "pauseStatuses", "warningPercent"].some((f) => f in req.body)) {
    return invalid(res, "Rules change through a new version (POST /new-version), so running tickets keep theirs.");
  }
  const data = {};
  if ("name" in req.body) {
    data.name = text(req.body.name, 120);
    if (!data.name) return invalid(res, "name can't be empty.");
  }
  if ("description" in req.body) data.description = text(req.body.description, 1000);
  if ("active" in req.body) data.active = Boolean(req.body.active);
  const policy = await prisma.slaPolicy.update({ where: { id: existing.id }, data: { ...data, updatedByMembershipId: who(req), version: { increment: 1 } }, include: POLICY_INCLUDE });
  await audit(req, "support.sla_policy.updated", "SlaPolicy", policy.id);
  res.json({ policy: toApi(policy) });
}

export async function newPolicyVersion(req, res) {
  const existing = await prisma.slaPolicy.findFirst({ where: { id: req.params.policyId, organizationId: req.organizationId }, include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } });
  if (!existing) return notFound(res, "SLA policy");
  if (existing.archivedAt) return invalid(res, "An archived policy can't get new versions.");
  if (staleVersion(req.body, existing)) return versionConflict(res, "SLA policy");
  const { data, error } = await versionData(req, req.body);
  if (error) return invalid(res, error);
  const previous = existing.versions[0];
  const policy = await prisma.$transaction(async (tx) => {
    const v = await tx.slaPolicyVersion.create({ data: { ...data, organizationId: req.organizationId, policyId: existing.id, versionNumber: (previous?.versionNumber || 0) + 1, createdByMembershipId: who(req) } });
    if (previous) await tx.slaPolicyVersion.update({ where: { id: previous.id }, data: { effectiveTo: data.effectiveFrom } });
    return tx.slaPolicy.update({ where: { id: existing.id }, data: { currentVersionId: v.id, updatedByMembershipId: who(req), version: { increment: 1 } }, include: POLICY_INCLUDE });
  });
  await audit(req, "support.sla_policy.versioned", "SlaPolicy", policy.id, { after: { versionNumber: (previous?.versionNumber || 0) + 1 } });
  res.status(201).json({ policy: toApi(policy) });
}

export async function archivePolicy(req, res) {
  const existing = await prisma.slaPolicy.findFirst({ where: { id: req.params.policyId, organizationId: req.organizationId } });
  if (!existing) return notFound(res, "SLA policy");
  if (existing.archivedAt) return invalid(res, "This policy is already archived.");
  const policy = await prisma.slaPolicy.update({ where: { id: existing.id }, data: { archivedAt: new Date(), active: false, updatedByMembershipId: who(req), version: { increment: 1 } }, include: POLICY_INCLUDE });
  await audit(req, "support.sla_policy.archived", "SlaPolicy", policy.id);
  res.json({ policy: toApi(policy) });
}

// ---------------------------------------------------------------- Entitlements

export async function listEntitlements(req, res) {
  const where = { organizationId: req.organizationId };
  if (req.query.companyId) where.companyId = req.query.companyId;
  if (req.query.active) where.active = req.query.active === "true";
  const entitlements = await prisma.supportEntitlement.findMany({ where, orderBy: [{ companyId: "asc" }, { effectiveFrom: "desc" }] });
  res.json({ entitlements: toApi(entitlements) });
}

export async function getEntitlement(req, res) {
  const e = await prisma.supportEntitlement.findFirst({ where: { id: req.params.entitlementId, organizationId: req.organizationId } });
  if (!e) return notFound(res, "Entitlement");
  res.json({ entitlement: toApi(e) });
}

async function entitlementFields(req, existing) {
  const b = req.body;
  const out = {};
  if (!existing) {
    const company = b.companyId && (await prisma.company.findFirst({ where: { id: b.companyId, organizationId: req.organizationId } }));
    if (!company) return { error: "companyId must be a company in this organization." };
    out.companyId = company.id;
  }
  const companyId = existing?.companyId || out.companyId;
  if (!existing || "name" in b) {
    out.name = text(b.name, 120);
    if (!out.name) return { error: "name is required." };
  }
  if ("description" in b) out.description = text(b.description, 1000);
  if ("contractId" in b) {
    if (b.contractId) {
      const contract = await prisma.contract.findFirst({ where: { id: b.contractId, organizationId: req.organizationId } });
      if (!contract || contract.companyId !== companyId) return { error: "contractId must be a contract of the same company in this organization." };
      if (!contractGrantsSupport(contract)) return { error: "That contract isn't signed and current, so it can't grant support." };
    }
    out.contractId = b.contractId || null;
  }
  if ("slaPolicyVersionId" in b) {
    if (b.slaPolicyVersionId && !(await prisma.slaPolicyVersion.findFirst({ where: { id: b.slaPolicyVersionId, organizationId: req.organizationId } }))) {
      return { error: "slaPolicyVersionId must be an SLA policy version from this organization." };
    }
    out.slaPolicyVersionId = b.slaPolicyVersionId || null;
  }
  for (const f of ["effectiveFrom", "effectiveTo"]) {
    if (f in b || (!existing && f === "effectiveFrom")) {
      const d = parseDate(b[f], f, { required: f === "effectiveFrom" });
      if (d.error) return { error: d.error };
      out[f] = d.value;
    }
  }
  const from = out.effectiveFrom || existing?.effectiveFrom;
  const to = "effectiveTo" in out ? out.effectiveTo : existing?.effectiveTo;
  if (from && to && to < from) return { error: "effectiveTo can't be before effectiveFrom." };
  if ("supportLevel" in b) out.supportLevel = text(b.supportLevel, 60) || "Standard";
  if ("allowedChannels" in b) {
    if (!Array.isArray(b.allowedChannels) || b.allowedChannels.some((c) => !CHANNELS.includes(c))) return { error: `allowedChannels must list channels from ${CHANNELS.join(", ")}.` };
    out.allowedChannels = b.allowedChannels;
  }
  if ("active" in b) out.active = Boolean(b.active);
  return { data: out };
}

export async function createEntitlement(req, res) {
  const { data, error } = await entitlementFields(req, null);
  if (error) return invalid(res, error);
  const e = await prisma.supportEntitlement.create({ data: { ...data, organizationId: req.organizationId, createdByMembershipId: who(req), updatedByMembershipId: who(req) } });
  await audit(req, "support.entitlement.created", "SupportEntitlement", e.id);
  res.status(201).json({ entitlement: toApi(e) });
}

export async function updateEntitlement(req, res) {
  const existing = await prisma.supportEntitlement.findFirst({ where: { id: req.params.entitlementId, organizationId: req.organizationId } });
  if (!existing) return notFound(res, "Entitlement");
  if (staleVersion(req.body, existing)) return versionConflict(res, "entitlement");
  const { data, error } = await entitlementFields(req, existing);
  if (error) return invalid(res, error);
  const e = await prisma.supportEntitlement.update({ where: { id: existing.id }, data: { ...data, updatedByMembershipId: who(req), version: { increment: 1 } } });
  await audit(req, "support.entitlement.updated", "SupportEntitlement", e.id, { before: { active: existing.active, slaPolicyVersionId: existing.slaPolicyVersionId }, after: { active: e.active, slaPolicyVersionId: e.slaPolicyVersionId } });
  res.json({ entitlement: toApi(e) });
}

// POST /support/tickets/:ticketId/entitlement { entitlementId|null, reason }
// A manual override of the automatically selected entitlement — needs the
// entitlements permission (route) and a reason. Running SLA clocks keep the
// policy they started with; the change is recorded for the history.
export async function overrideTicketEntitlement(req, res) {
  const reason = text(req.body.reason, 1000);
  if (!reason) return invalid(res, "A reason is required to override a ticket's entitlement.");
  const ticket = await prisma.ticket.findFirst({ where: { id: req.params.ticketId, organizationId: req.organizationId, ...ticketScopeWhere(req) } });
  if (!ticket) return notFound(res, "Ticket");
  const entitlementId = req.body.entitlementId || null;
  if (entitlementId) {
    const e = await prisma.supportEntitlement.findFirst({ where: { id: entitlementId, organizationId: req.organizationId, active: true } });
    if (!e || (ticket.companyId && e.companyId !== ticket.companyId)) return invalid(res, "entitlementId must be an active entitlement of the ticket's company.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: ticket.id }, data: { entitlementId, updatedByMembershipId: who(req), version: { increment: 1 } } });
    await ticketEvent(tx, { organizationId: req.organizationId, ticketId: ticket.id, eventType: "Entitlement Changed", actorMembershipId: who(req), fromValue: ticket.entitlementId, toValue: entitlementId, reason });
  });
  await audit(req, "support.ticket.entitlement_overridden", "Ticket", ticket.id, { reason, before: { entitlementId: ticket.entitlementId }, after: { entitlementId } });
  res.json({ ticketId: ticket.id, entitlementId });
}
