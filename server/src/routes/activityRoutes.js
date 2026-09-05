import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { crudFactory, asyncHandler } from "../utils/crudFactory.js";
import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";

const router = Router();
router.use(authenticate);

const ctrl = crudFactory({
  model: "activity",
  entityName: "Activity",
  responseKey: "activity",
  listKey: "activities",
  searchFields: ["title", "description"],
  defaultInclude: { owner: true, company: true, contact: true, deal: true },
  supportsArchive: false,
});

router.get("/", asyncHandler(async (req, res) => {
  const { companyId, contactId, dealId } = req.query;
  const where = {};
  if (companyId) where.companyId = companyId;
  if (contactId) where.contactId = contactId;
  if (dealId) where.dealId = dealId;
  const activities = await prisma.activity.findMany({ where, orderBy: { startAt: "desc" } });
  res.json({ activities: toApi(activities) });
}));
router.get("/:id/conflicts", asyncHandler(async (req, res) => {
  const activity = await prisma.activity.findUnique({ where: { id: req.params.id } });
  if (!activity?.startAt || !activity?.endAt) return res.json({ conflicts: [] });
  const conflicts = await prisma.activity.findMany({
    where: {
      id: { not: activity.id }, ownerId: activity.ownerId,
      startAt: { lt: activity.endAt }, endAt: { gt: activity.startAt },
    },
  });
  res.json({ conflicts: toApi(conflicts) });
}));
router.get("/:id", asyncHandler(ctrl.getOne));
router.post("/", asyncHandler(ctrl.create));
router.put("/:id", asyncHandler(ctrl.update));

router.post("/:id/complete", asyncHandler(async (req, res) => {
  const activity = await prisma.activity.update({ where: { id: req.params.id }, data: { status: "Completed", completedAt: new Date() } });
  res.json({ activity: toApi(activity) });
}));
router.post("/:id/reschedule", asyncHandler(async (req, res) => {
  const { startAt, endAt } = req.body;
  const activity = await prisma.activity.update({ where: { id: req.params.id }, data: { startAt: new Date(startAt), endAt: endAt ? new Date(endAt) : null } });
  res.json({ activity: toApi(activity) });
}));
router.post("/:id/cancel", asyncHandler(async (req, res) => {
  if (!req.body.reason?.trim()) return res.status(400).json({ message: "A cancellation reason is required" });
  const activity = await prisma.activity.update({ where: { id: req.params.id }, data: { status: "Cancelled", cancelReason: req.body.reason } });
  res.json({ activity: toApi(activity) });
}));
router.post("/:id/reopen", asyncHandler(async (req, res) => {
  const activity = await prisma.activity.update({ where: { id: req.params.id }, data: { status: "Open", completedAt: null } });
  res.json({ activity: toApi(activity) });
}));
router.post("/:id/followup", asyncHandler(async (req, res) => {
  const source = await prisma.activity.findUnique({ where: { id: req.params.id } });
  const followUp = await prisma.activity.create({
    data: { title: req.body.title || `Follow up: ${source.title}`, type: source.type, ownerId: source.ownerId,
      companyId: source.companyId, contactId: source.contactId, dealId: source.dealId, dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null },
  });
  res.status(201).json({ activity: toApi(followUp) });
}));
router.post("/:id/duplicate", asyncHandler(async (req, res) => {
  const source = await prisma.activity.findUnique({ where: { id: req.params.id } });
  const { id, createdAt, updatedAt, ...rest } = source;
  const copy = await prisma.activity.create({ data: { ...rest, status: "Open", completedAt: null } });
  res.status(201).json({ activity: toApi(copy) });
}));
router.post("/:id/attachments", asyncHandler(async (req, res) => {
  const activity = await prisma.activity.findUnique({ where: { id: req.params.id } });
  const attachments = [...(activity.attachments || []), { _id: crypto.randomUUID(), ...req.body, uploadedAt: new Date().toISOString() }];
  const updated = await prisma.activity.update({ where: { id: req.params.id }, data: { attachments } });
  res.json({ activity: toApi(updated) });
}));

router.post("/bulk/assign", asyncHandler(async (req, res) => {
  const { ids, ownerId } = req.body;
  await prisma.activity.updateMany({ where: { id: { in: ids || [] } }, data: { ownerId } });
  res.json({ activities: toApi(await prisma.activity.findMany({ where: { id: { in: ids || [] } } })) });
}));
router.post("/bulk/reschedule", asyncHandler(async (req, res) => {
  const { ids, startAt } = req.body;
  if (!startAt) return res.status(400).json({ message: "A new date/time is required" });
  await prisma.activity.updateMany({ where: { id: { in: ids || [] } }, data: { startAt: new Date(startAt) } });
  res.json({ activities: toApi(await prisma.activity.findMany({ where: { id: { in: ids || [] } } })) });
}));
router.post("/bulk/complete", asyncHandler(async (req, res) => {
  const { ids } = req.body;
  await prisma.activity.updateMany({ where: { id: { in: ids || [] } }, data: { status: "Completed", completedAt: new Date() } });
  res.json({ activities: toApi(await prisma.activity.findMany({ where: { id: { in: ids || [] } } })) });
}));
router.post("/bulk/cancel", asyncHandler(async (req, res) => {
  const { ids, reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ message: "A cancellation reason is required" });
  await prisma.activity.updateMany({ where: { id: { in: ids || [] } }, data: { status: "Cancelled", cancelReason: reason } });
  res.json({ activities: toApi(await prisma.activity.findMany({ where: { id: { in: ids || [] } } })) });
}));

export default router;
