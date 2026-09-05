import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { crudFactory, asyncHandler } from "../utils/crudFactory.js";
import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";

const router = Router();
router.use(authenticate);

const ctrl = crudFactory({
  model: "priceBook",
  entityName: "Price Book",
  responseKey: "priceBook",
  searchFields: ["name", "code", "description"],
  defaultInclude: { owner: true, entries: { include: { catalogItem: true } } },
  beforeCreate: async (payload) => {
    const { items, ...rest } = payload;
    return rest;
  },
});

router.get("/", asyncHandler(ctrl.list));
router.get("/:id", asyncHandler(ctrl.getOne));

router.post("/", asyncHandler(async (req, res) => {
  const { items = [], ...rest } = req.body;
  const priceBook = await prisma.priceBook.create({
    data: {
      ...rest,
      entries: {
        create: items.map((it) => ({
          catalogItemId: it.catalogItemId, currency: it.currency || "USD", adjustmentType: it.adjustmentType || "Fixed Price",
          adjustmentValue: Number(it.adjustmentValue) || 0, tiers: it.tiers || [], minQuantity: it.minQuantity ?? null,
          maxQuantity: it.maxQuantity ?? null, billingInterval: it.billingInterval || null, notes: it.notes || null, enabled: it.enabled !== false,
        })),
      },
    },
    include: { entries: true },
  });
  res.status(201).json({ priceBook: toApi(priceBook) });
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const { items, ...rest } = req.body;
  if (items) {
    await prisma.priceBookEntry.deleteMany({ where: { priceBookId: req.params.id } });
    await prisma.priceBookEntry.createMany({
      data: items.map((it) => ({
        priceBookId: req.params.id, catalogItemId: it.catalogItemId, currency: it.currency || "USD",
        adjustmentType: it.adjustmentType || "Fixed Price", adjustmentValue: Number(it.adjustmentValue) || 0,
        tiers: it.tiers || [], minQuantity: it.minQuantity ?? null, maxQuantity: it.maxQuantity ?? null,
        billingInterval: it.billingInterval || null, notes: it.notes || null, enabled: it.enabled !== false,
      })),
    });
  }
  const priceBook = await prisma.priceBook.update({ where: { id: req.params.id }, data: rest, include: { entries: true } });
  res.json({ priceBook: toApi(priceBook) });
}));

router.post("/:id/archive", asyncHandler(ctrl.archive));
router.post("/:id/restore", asyncHandler(ctrl.restore));
router.post("/bulk/assign", asyncHandler(ctrl.bulkAssign));
router.post("/bulk/archive", asyncHandler(ctrl.bulkArchive));
router.post("/bulk/status", asyncHandler(async (req, res) => {
  const { ids, status } = req.body;
  await prisma.priceBook.updateMany({ where: { id: { in: ids || [] } }, data: { status } });
  res.json({ priceBooks: toApi(await prisma.priceBook.findMany({ where: { id: { in: ids || [] } } })) });
}));

export default router;
