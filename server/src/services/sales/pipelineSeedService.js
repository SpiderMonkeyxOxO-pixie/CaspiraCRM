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

  // One insert for all 9 stages — each round trip counts against the
  // transaction's time limit, and the database may be far away.
  const stages = [
    ...OPEN_STAGES.map((s) => ({ ...s, classification: "Open" })),
    { ...WON_STAGE, classification: "Won" },
    ...OUTCOME_STAGES,
  ];
  await tx.pipelineStage.createMany({
    data: stages.map((s, displayOrder) => ({ organizationId, pipelineId: pipeline.id, name: s.name, displayOrder, classification: s.classification, probability: s.probability })),
  });
  return pipeline;
}

// Idempotent: if the organization already has at least one Pipeline, this
// is a no-op. Never re-seeds or duplicates on repeated calls.
export async function ensureDefaultPipelines(organizationId, membershipId) {
  const existing = await prisma.pipeline.count({ where: { organizationId } });
  if (existing > 0) return;

  try {
    await prisma.$transaction(
      async (tx) => {
        // Re-check inside the transaction to narrow the race between two
        // concurrent first-requests for the same brand-new organization.
        const stillNone = (await tx.pipeline.count({ where: { organizationId } })) === 0;
        if (!stillNone) return;
        for (const config of PIPELINE_CONFIGS) {
          await createPipelineWithStages(tx, organizationId, config, membershipId);
        }
      },
      { timeout: 30000 },
    );
  } catch (err) {
    // A concurrent request seeded first: the one-default-pipeline unique
    // index rejected this duplicate, and the pipelines now exist.
    if (err.code === "P2002" && (await prisma.pipeline.count({ where: { organizationId } })) > 0) return;
    throw err;
  }
}
