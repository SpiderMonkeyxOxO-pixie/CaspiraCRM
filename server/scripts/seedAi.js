// npm run db:seed:ai — seeds the AI provider catalog, models, prompt
// templates, the default (estimated) price tables and platform evaluation
// scenarios and Copilot workflow templates. Safe to run repeatedly.
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { seedAiCatalog } from "../src/ai/catalogSeed.js";
import { seedWorkflowTemplates } from "../src/ai/copilot/workflows.js";
import { seedGovernance } from "../src/ai/governance/seed.js";

try {
  const out = await seedAiCatalog(prisma);
  console.log(`AI providers: ${out.providers.created} created, ${out.providers.updated} updated`);
  console.log(`Models: ${out.models.created} created, ${out.models.updated} updated`);
  console.log(`Prompt templates: ${out.templates.created} versions created, ${out.templates.unchanged} unchanged`);
  if (out.templates.conflicts.length) console.warn(`Published template versions differ from code (not changed — publish a new version): ${out.templates.conflicts.join(", ")}`);
  console.log(`Price tables: ${out.priceTables.created} created (estimates — review before relying on them)`);
  console.log(`Evaluation scenarios: ${out.scenarios.created} created`);
  const wf = await seedWorkflowTemplates(prisma);
  console.log(`Copilot workflow templates: ${wf.created} created, ${wf.unchanged} unchanged`);
  const gov = await seedGovernance(prisma);
  console.log(`AI governance: ${Object.entries(gov).map(([k, v]) => `${k} +${v.created}`).join(", ")}`);
  if (wf.conflicts.length) console.warn(`Published workflow versions differ from code (not changed — publish a new version): ${wf.conflicts.join(", ")}`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  process.exit(); // the workflow engine's imports hold Redis connections open
}
