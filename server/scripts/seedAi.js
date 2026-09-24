// npm run db:seed:ai — seeds the AI provider catalog, models, prompt
// templates, the default (estimated) price tables and platform evaluation
// scenarios. Safe to run repeatedly.
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { seedAiCatalog } from "../src/ai/catalogSeed.js";

try {
  const out = await seedAiCatalog(prisma);
  console.log(`AI providers: ${out.providers.created} created, ${out.providers.updated} updated`);
  console.log(`Models: ${out.models.created} created, ${out.models.updated} updated`);
  console.log(`Prompt templates: ${out.templates.created} versions created, ${out.templates.unchanged} unchanged`);
  if (out.templates.conflicts.length) console.warn(`Published template versions differ from code (not changed — publish a new version): ${out.templates.conflicts.join(", ")}`);
  console.log(`Price tables: ${out.priceTables.created} created (estimates — review before relying on them)`);
  console.log(`Evaluation scenarios: ${out.scenarios.created} created`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
