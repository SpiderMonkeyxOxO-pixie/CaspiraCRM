import prisma from "../../lib/prisma.js";

// Matches the frontend's PIPELINE_CONFIGS (mockCrmData.js) exactly: 3
// pipelines, each with the same 6 ordered open/won stages plus 3 terminal
// outcome stages. Lazily seeded per-organization the first time that
// organization's Sales module is touched — Pipelines are org-scoped
// configuration, not global data, so a newly created organization gets
// these without a manual seed step.
const OPEN_STAGES = [
  { name: "Discovery", probability: 10 },
  { name: "Qualified", probability: 25 },
  { name: "Proposal", probability: 50 },
  { name: "Negotiation", probability: 70 },
  { name: "Approval", probability: 90 },
];
const WON_STAGE = { name: "Won", probability: 100 };
const OUTCOME_STAGES = [
  { name: "Lost", probability: 0, classification: "Lost" },
  { name: "Cancelled", probability: 0, classification: "Cancelled" },
  { name: "On Hold", probability: 0, classification: "OnHold" },
];

const PIPELINE_CONFIGS = [
  { name: "New Business", description: "Standard new-customer acquisition pipeline.", isDefault: true, wipLimits: null },
  { name: "Renewals", description: "Existing-customer renewal and expansion pipeline.", isDefault: false, wipLimits: null },
  { name: "Partnerships", description: "Partner and channel deal pipeline.", isDefault: false, wipLimits: { Negotiation: 6 } },
];

async function createPipelineWithStages(tx, organizationId, config, membershipId) {
  const pipeline = await tx.pipeline.create({
    data: {
      organizationId, name: config.name, description: config.description, isDefault: config.isDefault,
      wipLimits: config.wipLimits, createdByMembershipId: membershipId, updatedByMembershipId: membershipId,
    },
  });

  let order = 0;
  for (const stage of OPEN_STAGES) {
    await tx.pipelineStage.create({ data: { organizationId, pipelineId: pipeline.id, name: stage.name, displayOrder: order++, classification: "Open", probability: stage.probability } });
  }
  await tx.pipelineStage.create({ data: { organizationId, pipelineId: pipeline.id, name: WON_STAGE.name, displayOrder: order++, classification: "Won", probability: WON_STAGE.probability } });
  for (const stage of OUTCOME_STAGES) {
    await tx.pipelineStage.create({ data: { organizationId, pipelineId: pipeline.id, name: stage.name, displayOrder: order++, classification: stage.classification, probability: stage.probability } });
  }
  return pipeline;
}

// Idempotent: if the organization already has at least one Pipeline, this
// is a no-op. Never re-seeds or duplicates on repeated calls.
export async function ensureDefaultPipelines(organizationId, membershipId) {
  const existing = await prisma.pipeline.count({ where: { organizationId } });
  if (existing > 0) return;

  await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction to close the race between two
    // concurrent first-requests for the same brand-new organization.
    const stillNone = (await tx.pipeline.count({ where: { organizationId } })) === 0;
    if (!stillNone) return;
    for (const config of PIPELINE_CONFIGS) {
      await createPipelineWithStages(tx, organizationId, config, membershipId);
    }
  });
}
