import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../utils/crudFactory.js";
import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";

const router = Router();
router.use(authenticate);

// --- Campaigns ---
router.get("/campaigns", asyncHandler(async (req, res) => {
  const campaigns = await prisma.campaign.findMany({ orderBy: { updatedAt: "desc" } });
  res.json({ campaigns: toApi(campaigns) });
}));
router.get("/campaigns/:id", asyncHandler(async (req, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) return res.status(404).json({ message: "Campaign not found" });
  res.json({ campaign: toApi(campaign) });
}));
router.post("/campaigns", asyncHandler(async (req, res) => {
  const campaign = await prisma.campaign.create({ data: req.body });
  res.status(201).json({ campaign: toApi(campaign) });
}));
router.put("/campaigns/:id", asyncHandler(async (req, res) => {
  const campaign = await prisma.campaign.update({ where: { id: req.params.id }, data: req.body });
  res.json({ campaign: toApi(campaign) });
}));

// --- Segments (membership computed live, matching the mock layer — no
// stored member list, just the defining field/value pair) ---
router.get("/segments", asyncHandler(async (req, res) => {
  const segments = await prisma.segment.findMany({ orderBy: { createdAt: "desc" } });
  const withCounts = await Promise.all(segments.map(async (s) => {
    const memberCount = await prisma.company.count({ where: { [s.field]: s.value } });
    return { ...s, memberCount };
  }));
  res.json({ segments: toApi(withCounts) });
}));
router.post("/segments", asyncHandler(async (req, res) => {
  const segment = await prisma.segment.create({ data: req.body });
  res.status(201).json({ segment: toApi(segment) });
}));
router.delete("/segments/:id", asyncHandler(async (req, res) => {
  await prisma.segment.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

// --- Forms ---
router.get("/forms", asyncHandler(async (req, res) => {
  const forms = await prisma.marketingForm.findMany({ include: { campaign: true }, orderBy: { updatedAt: "desc" } });
  res.json({ forms: toApi(forms) });
}));
router.post("/forms", asyncHandler(async (req, res) => {
  const form = await prisma.marketingForm.create({ data: req.body });
  res.status(201).json({ form: toApi(form) });
}));
router.post("/forms/:id/submit", asyncHandler(async (req, res) => {
  const form = await prisma.marketingForm.findUnique({ where: { id: req.params.id } });
  if (!form) return res.status(404).json({ message: "Form not found" });
  await prisma.marketingForm.update({ where: { id: req.params.id }, data: { submissions: form.submissions + 1 } });
  const lead = await prisma.lead.create({
    data: { name: req.body.name, email: req.body.email, phone: req.body.phone, source: "Website", campaignId: form.campaignId, status: "New" },
  });
  res.status(201).json({ lead: toApi(lead) });
}));

// --- Templates ---
router.get("/templates", asyncHandler(async (req, res) => {
  const templates = await prisma.marketingTemplate.findMany({ orderBy: { updatedAt: "desc" } });
  res.json({ templates: toApi(templates) });
}));
router.post("/templates", asyncHandler(async (req, res) => {
  const template = await prisma.marketingTemplate.create({ data: req.body });
  res.status(201).json({ template: toApi(template) });
}));

export default router;
