import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { crudFactory, asyncHandler } from "../utils/crudFactory.js";
import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";

const router = Router();
router.use(authenticate);

const ctrl = crudFactory({
  model: "catalogItem",
  entityName: "Product/Service",
  responseKey: "product",
  searchFields: ["name", "sku", "description"],
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

router.post("/bulk/category", asyncHandler(async (req, res) => {
  const { ids, category } = req.body;
  await prisma.catalogItem.updateMany({ where: { id: { in: ids || [] } }, data: { category } });
  res.json({ products: toApi(await prisma.catalogItem.findMany({ where: { id: { in: ids || [] } } })) });
}));
router.post("/bulk/status", asyncHandler(async (req, res) => {
  const { ids, status } = req.body;
  await prisma.catalogItem.updateMany({ where: { id: { in: ids || [] } }, data: { status } });
  res.json({ products: toApi(await prisma.catalogItem.findMany({ where: { id: { in: ids || [] } } })) });
}));
router.post("/bulk/tag", asyncHandler(async (req, res) => {
  const { ids, tag } = req.body;
  const items = await prisma.catalogItem.findMany({ where: { id: { in: ids || [] } } });
  await Promise.all(items.map((it) => prisma.catalogItem.update({ where: { id: it.id }, data: { tags: [...new Set([...(it.tags || []), tag])] } })));
  res.json({ products: toApi(await prisma.catalogItem.findMany({ where: { id: { in: ids || [] } } })) });
}));

export default router;
