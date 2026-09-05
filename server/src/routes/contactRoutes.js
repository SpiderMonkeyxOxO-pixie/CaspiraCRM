import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { crudFactory, asyncHandler } from "../utils/crudFactory.js";
import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";

const router = Router();
router.use(authenticate);

const ctrl = crudFactory({
  model: "contact",
  entityName: "Contact",
  responseKey: "contact",
  searchFields: ["name", "email", "phone"],
  defaultInclude: { company: true, owner: true },
});

router.get("/", asyncHandler(ctrl.list));
router.get("/:id", asyncHandler(ctrl.getOne));
router.post("/", asyncHandler(ctrl.create));
router.put("/:id", asyncHandler(ctrl.update));
router.post("/:id/archive", asyncHandler(ctrl.archive));
router.post("/:id/restore", asyncHandler(ctrl.restore));
router.post("/bulk/assign", asyncHandler(ctrl.bulkAssign));
router.post("/bulk/archive", asyncHandler(ctrl.bulkArchive));

router.post("/:id/consent", asyncHandler(async (req, res) => {
  const contact = await prisma.contact.update({ where: { id: req.params.id }, data: req.body });
  res.json({ contact: toApi(contact) });
}));

router.post("/:id/notes", asyncHandler(async (req, res) => {
  const contact = await prisma.contact.findUnique({ where: { id: req.params.id } });
  if (!contact) return res.status(404).json({ message: "Contact not found" });
  const note = { _id: crypto.randomUUID(), message: req.body.message, author: req.user.name, at: new Date().toISOString() };
  const updated = await prisma.contact.update({ where: { id: req.params.id }, data: { notes: [...(contact.notes || []), note] } });
  res.json({ contact: toApi(updated) });
}));

export default router;
