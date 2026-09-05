import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { crudFactory, asyncHandler } from "../utils/crudFactory.js";
import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";

const router = Router();
router.use(authenticate);

const ctrl = crudFactory({
  model: "company",
  entityName: "Company",
  responseKey: "company",
  listKey: "companies",
  searchFields: ["name", "website", "industry"],
  defaultInclude: { owner: true },
});

router.get("/", asyncHandler(ctrl.list));
router.get("/:id", asyncHandler(ctrl.getOne));
router.post("/", asyncHandler(ctrl.create));
router.put("/:id", asyncHandler(ctrl.update));
router.post("/:id/archive", asyncHandler(ctrl.archive));
router.post("/:id/restore", asyncHandler(ctrl.restore));
router.post("/bulk/assign", asyncHandler(ctrl.bulkAssign));
router.post("/bulk/archive", asyncHandler(ctrl.bulkArchive));

router.post("/:id/notes", asyncHandler(async (req, res) => {
  const company = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!company) return res.status(404).json({ message: "Company not found" });
  const note = { _id: crypto.randomUUID(), message: req.body.message, author: req.user.name, at: new Date().toISOString() };
  const notes = [...(company.notes || []), note];
  const updated = await prisma.company.update({ where: { id: req.params.id }, data: { notes } });
  res.json({ company: toApi(updated) });
}));

router.post("/:id/activity", asyncHandler(async (req, res) => {
  const company = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!company) return res.status(404).json({ message: "Company not found" });
  const entry = { _id: crypto.randomUUID(), type: req.body.type || "note", actor: req.user.name, at: new Date().toISOString(), description: req.body.description || "" };
  const activityLog = [...(company.activityLog || []), entry];
  const updated = await prisma.company.update({ where: { id: req.params.id }, data: { activityLog } });
  res.json({ company: toApi(updated) });
}));

router.post("/:id/contacts", asyncHandler(async (req, res) => {
  const contact = await prisma.contact.create({ data: { ...req.body, companyId: req.params.id } });
  res.status(201).json({ contact: toApi(contact) });
}));

router.delete("/:id/contacts/:contactId", asyncHandler(async (req, res) => {
  await prisma.contact.update({ where: { id: req.params.contactId }, data: { companyId: null } });
  res.json({ success: true });
}));

router.post("/:id/contacts/:contactId/primary", asyncHandler(async (req, res) => {
  await prisma.contact.updateMany({ where: { companyId: req.params.id }, data: { isPrimary: false } });
  const contact = await prisma.contact.update({ where: { id: req.params.contactId }, data: { isPrimary: true } });
  res.json({ contact: toApi(contact) });
}));

export default router;
