import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../utils/crudFactory.js";
import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";

const router = Router();
router.use(authenticate);

let ticketCounter = 1000;
const SLA_HOURS = { Urgent: [1, 4], High: [4, 24], Medium: [8, 48], Low: [24, 72] };
const include = { company: true, contact: true, assignedAgent: true };

router.get("/", asyncHandler(async (req, res) => {
  const { search, status, priority, companyId } = req.query;
  const where = {};
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (companyId) where.companyId = companyId;
  if (search) where.OR = [{ ticketNumber: { contains: search, mode: "insensitive" } }, { subject: { contains: search, mode: "insensitive" } }];
  const tickets = await prisma.ticket.findMany({ where, include, orderBy: { createdAt: "desc" } });
  res.json({ tickets: toApi(tickets) });
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id }, include });
  if (!ticket) return res.status(404).json({ message: "Ticket not found" });
  res.json({ ticket: toApi(ticket) });
}));

router.post("/", asyncHandler(async (req, res) => {
  const priority = req.body.priority || "Medium";
  const [responseHrs, resolutionHrs] = SLA_HOURS[priority] || SLA_HOURS.Medium;
  const now = Date.now();
  const ticket = await prisma.ticket.create({
    data: {
      ...req.body, ticketNumber: `TCK-${++ticketCounter}`, priority,
      slaResponseDeadline: new Date(now + responseHrs * 3600 * 1000),
      slaResolutionDeadline: new Date(now + resolutionHrs * 3600 * 1000),
    },
    include,
  });
  res.status(201).json({ ticket: toApi(ticket) });
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const ticket = await prisma.ticket.update({ where: { id: req.params.id }, data: req.body, include });
  res.json({ ticket: toApi(ticket) });
}));

router.post("/:id/replies", asyncHandler(async (req, res) => {
  const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!ticket) return res.status(404).json({ message: "Ticket not found" });
  const reply = { message: req.body.message, author: req.user.name, at: new Date().toISOString() };
  const data = { publicReplies: [...(ticket.publicReplies || []), reply] };
  if (!ticket.firstRespondedAt) data.firstRespondedAt = new Date();
  const updated = await prisma.ticket.update({ where: { id: req.params.id }, data });
  res.json({ ticket: toApi(updated) });
}));

router.post("/:id/notes", asyncHandler(async (req, res) => {
  const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!ticket) return res.status(404).json({ message: "Ticket not found" });
  const note = { message: req.body.message, author: req.user.name, at: new Date().toISOString() };
  const updated = await prisma.ticket.update({ where: { id: req.params.id }, data: { privateNotes: [...(ticket.privateNotes || []), note] } });
  res.json({ ticket: toApi(updated) });
}));

router.post("/:id/escalate", asyncHandler(async (req, res) => {
  const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!ticket) return res.status(404).json({ message: "Ticket not found" });
  const escalation = { from: req.user.name, to: req.body.to, reason: req.body.reason, at: new Date().toISOString() };
  const updated = await prisma.ticket.update({ where: { id: req.params.id }, data: { escalations: [...(ticket.escalations || []), escalation], priority: "Urgent" } });
  res.json({ ticket: toApi(updated) });
}));

router.post("/:id/resolve", asyncHandler(async (req, res) => {
  const updated = await prisma.ticket.update({
    where: { id: req.params.id },
    data: { status: "Resolved", resolutionSummary: req.body.summary || null, resolvedAt: new Date() },
  });
  res.json({ ticket: toApi(updated) });
}));

export default router;
