import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { crudFactory, asyncHandler } from "../utils/crudFactory.js";
import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";

const router = Router();
router.use(authenticate);

const ctrl = crudFactory({
  model: "lead",
  entityName: "Lead",
  responseKey: "lead",
  searchFields: ["name", "companyName", "email"],
});

router.get("/", asyncHandler(ctrl.list));
router.get("/:id", asyncHandler(ctrl.getOne));
router.post("/", asyncHandler(ctrl.create));
router.put("/:id", asyncHandler(ctrl.update));
router.post("/bulk/assign", asyncHandler(ctrl.bulkAssign));
router.post("/bulk/archive", asyncHandler(ctrl.bulkArchive));

router.post("/bulk/status", asyncHandler(async (req, res) => {
  const { ids, status } = req.body;
  await prisma.lead.updateMany({ where: { id: { in: ids || [] } }, data: { status } });
  const leads = await prisma.lead.findMany({ where: { id: { in: ids || [] } } });
  res.json({ leads: toApi(leads) });
}));

// Converting a Lead creates real Company/Contact/Deal records and marks
// the Lead as converted — the frontend's most important Lead action.
router.post("/:id/convert", asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ message: "Lead not found" });
  if (lead.convertedDealId) return res.status(400).json({ message: "This Lead has already been converted" });

  const { createCompany = true, createDeal = true, dealName, dealValue } = req.body;

  const result = await prisma.$transaction(async (tx) => {
    let company = null;
    if (createCompany && lead.companyName) {
      company = await tx.company.create({ data: { name: lead.companyName, ownerId: lead.ownerId } });
    }
    const contact = await tx.contact.create({
      data: {
        name: lead.name || `${lead.firstName || ""} ${lead.lastName || ""}`.trim() || "Unnamed Contact",
        firstName: lead.firstName, lastName: lead.lastName, email: lead.email, phone: lead.phone,
        companyId: company?.id || null, isPrimary: true, ownerId: lead.ownerId,
      },
    });
    let deal = null;
    if (createDeal) {
      deal = await tx.deal.create({
        data: {
          name: dealName || `${lead.companyName || lead.name || "New"} Opportunity`,
          stage: "Qualification", companyId: company?.id || null, primaryContactId: contact.id,
          ownerId: lead.ownerId, value: Number(dealValue) || 0,
        },
      });
    }
    const updatedLead = await tx.lead.update({
      where: { id: lead.id },
      data: { status: "Converted", convertedCompanyId: company?.id || null, convertedContactId: contact.id, convertedDealId: deal?.id || null },
    });
    return { lead: updatedLead, company, contact, deal };
  });

  res.json({ lead: toApi(result.lead), company: toApi(result.company), contact: toApi(result.contact), deal: toApi(result.deal) });
}));

router.post("/:id/archive", requireRole("Super-Admin", "Admin", "Team-Leader"), asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ message: "A reason is required to archive" });
  const lead = await prisma.lead.update({ where: { id: req.params.id }, data: { archived: true, archiveReason: reason } });
  res.json({ lead: toApi(lead) });
}));

// Only a System Owner can restore an archived Lead or reopen a converted
// one — mirrors the frontend's own established restriction on these two
// specific Lead actions.
router.post("/:id/restore", requireRole("Super-Admin"), asyncHandler(async (req, res) => {
  const lead = await prisma.lead.update({ where: { id: req.params.id }, data: { archived: false, archiveReason: null } });
  res.json({ lead: toApi(lead) });
}));

router.post("/:id/reopen", requireRole("Super-Admin"), asyncHandler(async (req, res) => {
  const lead = await prisma.lead.update({ where: { id: req.params.id }, data: { status: "Open" } });
  res.json({ lead: toApi(lead) });
}));

router.post("/:id/notes", asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ message: "Lead not found" });
  const note = { _id: crypto.randomUUID(), message: req.body.message, author: req.user.name, at: new Date().toISOString() };
  const updated = await prisma.lead.update({ where: { id: req.params.id }, data: { notes: [...(lead.notes || []), note] } });
  res.json({ lead: toApi(updated) });
}));

export default router;
