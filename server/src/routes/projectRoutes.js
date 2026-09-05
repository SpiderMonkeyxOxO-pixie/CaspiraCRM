import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../utils/crudFactory.js";
import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";

const router = Router();
router.use(authenticate);
const include = { company: true, deal: true, owner: true, milestones: true };

router.get("/", asyncHandler(async (req, res) => {
  const { companyId, status } = req.query;
  const where = {};
  if (companyId) where.companyId = companyId;
  if (status) where.status = status;
  const projects = await prisma.project.findMany({ where, include, orderBy: { updatedAt: "desc" } });
  res.json({ projects: toApi(projects) });
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id }, include: { ...include, tasks: true } });
  if (!project) return res.status(404).json({ message: "Project not found" });
  res.json({ project: toApi(project) });
}));

router.post("/", asyncHandler(async (req, res) => {
  const project = await prisma.project.create({ data: req.body, include });
  res.status(201).json({ project: toApi(project) });
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const project = await prisma.project.update({ where: { id: req.params.id }, data: req.body, include });
  res.json({ project: toApi(project) });
}));

router.post("/:id/milestones", asyncHandler(async (req, res) => {
  const milestone = await prisma.milestone.create({ data: { ...req.body, projectId: req.params.id } });
  res.status(201).json({ milestone: toApi(milestone) });
}));

router.put("/:id/milestones/:milestoneId", asyncHandler(async (req, res) => {
  const milestone = await prisma.milestone.update({ where: { id: req.params.milestoneId }, data: req.body });
  res.json({ milestone: toApi(milestone) });
}));

export default router;
