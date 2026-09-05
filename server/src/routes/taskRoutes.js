import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../utils/crudFactory.js";
import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";

const router = Router();
router.use(authenticate);
const include = { project: true, assignee: true };

router.get("/", asyncHandler(async (req, res) => {
  const { projectId, assigneeId, status } = req.query;
  const where = {};
  if (projectId) where.projectId = projectId;
  if (assigneeId) where.assigneeId = assigneeId;
  if (status) where.status = status;
  const tasks = await prisma.task.findMany({ where, include, orderBy: { updatedAt: "desc" } });
  res.json({ tasks: toApi(tasks) });
}));

router.post("/", asyncHandler(async (req, res) => {
  const task = await prisma.task.create({ data: req.body, include });
  res.status(201).json({ task: toApi(task) });
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const task = await prisma.task.update({ where: { id: req.params.id }, data: req.body, include });
  res.json({ task: toApi(task) });
}));

router.post("/:id/comments", asyncHandler(async (req, res) => {
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ message: "Task not found" });
  const comment = { message: req.body.message, author: req.user.name, at: new Date().toISOString() };
  const updated = await prisma.task.update({ where: { id: req.params.id }, data: { comments: [...(task.comments || []), comment] } });
  res.json({ task: toApi(updated) });
}));

router.post("/:id/time", asyncHandler(async (req, res) => {
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ message: "Task not found" });
  const hours = Number(req.body.hours) || 0;
  const entry = { hours, note: req.body.note || "", author: req.user.name, at: new Date().toISOString() };
  const updated = await prisma.task.update({
    where: { id: req.params.id },
    data: { timeEntries: [...(task.timeEntries || []), entry], loggedHours: task.loggedHours + hours },
  });
  res.json({ task: toApi(updated) });
}));

export default router;
