import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { crudFactory, asyncHandler } from "../utils/crudFactory.js";
import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";

const router = Router();
router.use(authenticate);

const ctrl = crudFactory({
  model: "deal",
  entityName: "Deal",
  responseKey: "deal",
  searchFields: ["name"],
  defaultInclude: { company: true, primaryContact: true, owner: true, lineItems: true },
});

function activityEntry(type, actor, description) {
  return { _id: crypto.randomUUID(), type, actor, at: new Date().toISOString(), description };
}

router.get("/", asyncHandler(ctrl.list));
router.get("/:id", asyncHandler(ctrl.getOne));
router.post("/", asyncHandler(ctrl.create));
router.put("/:id", asyncHandler(ctrl.update));
router.post("/:id/archive", asyncHandler(ctrl.archive));
router.post("/:id/restore", asyncHandler(ctrl.restore));
router.post("/bulk/assign", asyncHandler(ctrl.bulkAssign));
router.post("/bulk/archive", asyncHandler(ctrl.bulkArchive));

router.post("/bulk/stage", asyncHandler(async (req, res) => {
  const { ids, stage } = req.body;
  await prisma.deal.updateMany({ where: { id: { in: ids || [] } }, data: { stage } });
  res.json({ deals: toApi(await prisma.deal.findMany({ where: { id: { in: ids || [] } } })) });
}));

router.post("/:id/stage", asyncHandler(async (req, res) => {
  const deal = await prisma.deal.findUnique({ where: { id: req.params.id } });
  if (!deal) return res.status(404).json({ message: "Deal not found" });
  const activityLog = [...(deal.activityLog || []), activityEntry("stage_changed", req.user.name, `Stage changed to ${req.body.stage}`)];
  const updated = await prisma.deal.update({ where: { id: req.params.id }, data: { stage: req.body.stage, activityLog } });
  res.json({ deal: toApi(updated) });
}));

router.post("/:id/win", asyncHandler(async (req, res) => {
  const { actualClosingDate, winReason, value } = req.body;
  const deal = await prisma.deal.findUnique({ where: { id: req.params.id } });
  if (!deal) return res.status(404).json({ message: "Deal not found" });
  const activityLog = [...(deal.activityLog || []), activityEntry("won", req.user.name, `Marked Won: ${winReason || ""}`)];
  const updated = await prisma.deal.update({
    where: { id: req.params.id },
    data: {
      status: "Won", stage: "Closed Won",
      actualClosingDate: actualClosingDate ? new Date(actualClosingDate) : new Date(),
      winReason, value: value !== undefined ? Number(value) : deal.value, activityLog,
    },
  });
  res.json({ deal: toApi(updated) });
}));

router.post("/:id/lost", asyncHandler(async (req, res) => {
  const { lossReason } = req.body;
  if (!lossReason?.trim()) return res.status(400).json({ message: "A loss reason is required" });
  const deal = await prisma.deal.findUnique({ where: { id: req.params.id } });
  const activityLog = [...(deal.activityLog || []), activityEntry("lost", req.user.name, `Marked Lost: ${lossReason}`)];
  const updated = await prisma.deal.update({ where: { id: req.params.id }, data: { status: "Lost", stage: "Closed Lost", lossReason, activityLog } });
  res.json({ deal: toApi(updated) });
}));

router.post("/:id/cancel", asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ message: "A cancellation reason is required" });
  const updated = await prisma.deal.update({ where: { id: req.params.id }, data: { status: "Cancelled", cancelReason: reason } });
  res.json({ deal: toApi(updated) });
}));

router.post("/:id/hold", asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ message: "A reason is required to place a Deal on hold" });
  const updated = await prisma.deal.update({ where: { id: req.params.id }, data: { status: "On Hold", holdReason: reason } });
  res.json({ deal: toApi(updated) });
}));

router.post("/:id/reopen", asyncHandler(async (req, res) => {
  const updated = await prisma.deal.update({ where: { id: req.params.id }, data: { status: "Open", holdReason: null } });
  res.json({ deal: toApi(updated) });
}));

router.put("/:id/line-items", asyncHandler(async (req, res) => {
  const { lineItems = [] } = req.body;
  await prisma.dealLineItem.deleteMany({ where: { dealId: req.params.id } });
  await prisma.dealLineItem.createMany({
    data: lineItems.map((l, i) => ({
      dealId: req.params.id, catalogItemId: l.catalogItemId || l.productId || null, priceBookId: l.priceBookId || null,
      quantity: Number(l.quantity) || 1, unitPrice: Number(l.unitPrice) || 0, discountType: l.discountType || null,
      discountValue: l.discountValue ?? null, taxCategory: l.taxCategory || "Standard", order: i,
    })),
  });
  const deal = await prisma.deal.findUnique({ where: { id: req.params.id }, include: { lineItems: true } });
  res.json({ deal: toApi(deal) });
}));

router.post("/:id/contacts", asyncHandler(async (req, res) => {
  const deal = await prisma.deal.findUnique({ where: { id: req.params.id } });
  const additionalContactIds = [...(deal.additionalContactIds || []), req.body.contactId];
  const updated = await prisma.deal.update({ where: { id: req.params.id }, data: { additionalContactIds } });
  res.json({ deal: toApi(updated) });
}));

router.delete("/:id/contacts/:contactId", asyncHandler(async (req, res) => {
  const deal = await prisma.deal.findUnique({ where: { id: req.params.id } });
  const additionalContactIds = (deal.additionalContactIds || []).filter((id) => id !== req.params.contactId);
  const updated = await prisma.deal.update({ where: { id: req.params.id }, data: { additionalContactIds } });
  res.json({ deal: toApi(updated) });
}));

router.post("/:id/contacts/:contactId/primary", asyncHandler(async (req, res) => {
  const updated = await prisma.deal.update({ where: { id: req.params.id }, data: { primaryContactId: req.params.contactId } });
  res.json({ deal: toApi(updated) });
}));

router.post("/:id/quotes", asyncHandler(async (req, res) => {
  res.json({ message: "Use POST /sales/quotes with dealId set instead" });
}));

export default router;
