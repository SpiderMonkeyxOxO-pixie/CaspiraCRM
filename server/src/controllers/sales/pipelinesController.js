import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { ensureDefaultPipelines } from "../../services/sales/pipelineSeedService.js";

const CLASSIFICATIONS = new Set(["Open", "Won", "Lost", "Cancelled", "OnHold"]);

export async function list(req, res) {
  await ensureDefaultPipelines(req.organizationId, req.membership?.id);
  const where = { organizationId: req.organizationId };
  if (req.query.archived !== "true") where.archivedAt = null;
  const pipelines = await prisma.pipeline.findMany({ where, orderBy: { createdAt: "asc" }, include: { stages: { where: { archivedAt: null }, orderBy: { displayOrder: "asc" } } } });
  res.json({ pipelines: toApi(pipelines) });
}

export async function getOne(req, res) {
  const pipeline = await prisma.pipeline.findFirst({ where: { id: req.params.pipelineId, organizationId: req.organizationId }, include: { stages: { orderBy: { displayOrder: "asc" } } } });
  if (!pipeline) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Pipeline not found." });
  res.json({ pipeline: toApi(pipeline) });
}

export async function create(req, res) {
  const { name, description, currencyPolicy, isDefault } = req.body;
  if (!name?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "name is required." });

  const pipeline = await prisma.$transaction(async (tx) => {
    if (isDefault) {
      // At most one active default Pipeline per organization — demote any
      // existing default before promoting this one (defense in depth
      // alongside the DB partial unique index).
      await tx.pipeline.updateMany({ where: { organizationId: req.organizationId, isDefault: true, archivedAt: null }, data: { isDefault: false } });
    }
    return tx.pipeline.create({
      data: { organizationId: req.organizationId, name: name.trim(), description, currencyPolicy, isDefault: !!isDefault, createdByMembershipId: req.membership?.id, updatedByMembershipId: req.membership?.id },
    });
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.pipeline.created", targetType: "Pipeline", targetId: pipeline.id, result: "Success" });
  res.status(201).json({ pipeline: toApi(pipeline) });
}

export async function update(req, res) {
  const existing = await prisma.pipeline.findFirst({ where: { id: req.params.pipelineId, organizationId: req.organizationId } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Pipeline not found." });
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) {
    return res.status(409).json({ code: "SALES_VERSION_CONFLICT", message: "This pipeline was updated by someone else. Refresh and try again." });
  }
  const { version, id, organizationId, createdAt, ...rest } = req.body;

  const pipeline = await prisma.$transaction(async (tx) => {
    if (rest.isDefault === true && !existing.isDefault) {
      await tx.pipeline.updateMany({ where: { organizationId: req.organizationId, isDefault: true, archivedAt: null, id: { not: existing.id } }, data: { isDefault: false } });
    }
    return tx.pipeline.update({ where: { id: existing.id }, data: { ...rest, updatedByMembershipId: req.membership?.id, version: { increment: 1 } } });
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.pipeline.updated", targetType: "Pipeline", targetId: pipeline.id, result: "Success", before: toApi(existing), after: toApi(pipeline) });
  res.json({ pipeline: toApi(pipeline) });
}

export async function archive(req, res) {
  const existing = await prisma.pipeline.findFirst({ where: { id: req.params.pipelineId, organizationId: req.organizationId } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Pipeline not found." });
  const activeDealCount = await prisma.deal.count({ where: { pipelineId: existing.id, archived: false, status: "Open" } });
  if (activeDealCount > 0) return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "This Pipeline has active Deals and cannot be archived." });

  const pipeline = await prisma.pipeline.update({ where: { id: existing.id }, data: { archivedAt: new Date(), active: false, isDefault: false, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.pipeline.archived", targetType: "Pipeline", targetId: pipeline.id, result: "Success" });
  res.json({ pipeline: toApi(pipeline) });
}

export async function restore(req, res) {
  const existing = await prisma.pipeline.findFirst({ where: { id: req.params.pipelineId, organizationId: req.organizationId } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Pipeline not found." });
  const pipeline = await prisma.pipeline.update({ where: { id: existing.id }, data: { archivedAt: null, active: true, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.pipeline.restored", targetType: "Pipeline", targetId: pipeline.id, result: "Success" });
  res.json({ pipeline: toApi(pipeline) });
}

export async function createStage(req, res) {
  const pipeline = await prisma.pipeline.findFirst({ where: { id: req.params.pipelineId, organizationId: req.organizationId } });
  if (!pipeline) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Pipeline not found." });
  const { name, description, classification = "Open", probability = 0, requiredFields, entryRules, exitRules } = req.body;
  if (!name?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "name is required." });
  if (!CLASSIFICATIONS.has(classification)) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "Invalid stage classification." });
  if (!Number.isInteger(probability) || probability < 0 || probability > 100) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "probability must be an integer from 0 to 100." });

  const maxOrder = await prisma.pipelineStage.aggregate({ where: { pipelineId: pipeline.id }, _max: { displayOrder: true } });
  const stage = await prisma.pipelineStage.create({
    data: {
      organizationId: req.organizationId, pipelineId: pipeline.id, name: name.trim(), description, classification, probability,
      displayOrder: (maxOrder._max.displayOrder ?? -1) + 1, requiredFields: requiredFields || [], entryRules: entryRules || [], exitRules: exitRules || [],
    },
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.pipeline.stage_created", targetType: "PipelineStage", targetId: stage.id, result: "Success" });
  res.status(201).json({ stage: toApi(stage) });
}

export async function updateStage(req, res) {
  const stage = await prisma.pipelineStage.findFirst({ where: { id: req.params.stageId, pipelineId: req.params.pipelineId, organizationId: req.organizationId } });
  if (!stage) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Stage not found." });
  const { probability, classification } = req.body;
  if (probability !== undefined && (!Number.isInteger(probability) || probability < 0 || probability > 100)) {
    return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "probability must be an integer from 0 to 100." });
  }
  if (classification !== undefined && !CLASSIFICATIONS.has(classification)) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "Invalid stage classification." });

  const { id, pipelineId, organizationId, displayOrder, createdAt, ...rest } = req.body;
  const before = toApi(stage);
  // Changing a Stage's probability affects current forecast calculations
  // (read live at query time) but never rewrites DealStageHistory — those
  // rows already snapshot the probability at the moment of each past
  // transition.
  const updated = await prisma.pipelineStage.update({ where: { id: stage.id }, data: rest });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.pipeline.stage_updated", targetType: "PipelineStage", targetId: updated.id, result: "Success", before, after: toApi(updated) });
  res.json({ stage: toApi(updated) });
}

export async function reorderStages(req, res) {
  const pipeline = await prisma.pipeline.findFirst({ where: { id: req.params.pipelineId, organizationId: req.organizationId } });
  if (!pipeline) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Pipeline not found." });
  const { stageIds } = req.body;
  if (!Array.isArray(stageIds) || stageIds.length === 0) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "stageIds must be a non-empty array." });

  const existingStages = await prisma.pipelineStage.findMany({ where: { pipelineId: pipeline.id } });
  const existingIds = new Set(existingStages.map((s) => s.id));
  if (stageIds.length !== existingStages.length || !stageIds.every((id) => existingIds.has(id))) {
    return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "stageIds must include exactly the Pipeline's current Stages, once each." });
  }

  await prisma.$transaction(stageIds.map((id, index) => prisma.pipelineStage.update({ where: { id }, data: { displayOrder: index } })));
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.pipeline.stages_reordered", targetType: "Pipeline", targetId: pipeline.id, result: "Success", after: { stageIds } });
  const stages = await prisma.pipelineStage.findMany({ where: { pipelineId: pipeline.id }, orderBy: { displayOrder: "asc" } });
  res.json({ stages: toApi(stages) });
}
