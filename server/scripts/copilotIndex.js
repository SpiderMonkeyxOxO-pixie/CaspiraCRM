// npm run copilot:index [-- --rebuild] [--org <organizationId>]
// Processes queued Copilot indexing jobs (what the worker does every 10 s).
// With --rebuild, first queues every indexable record (all organizations, or
// just --org). Safe to run repeatedly: unchanged records are skipped.
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { rebuildOrganization, runIndexingJobs } from "../src/ai/copilot/retrieval/indexer.js";
import { embeddingConfig } from "../src/ai/copilot/retrieval/embeddings.js";

const args = process.argv.slice(2);
const orgArg = args.includes("--org") ? args[args.indexOf("--org") + 1] : null;
try {
  const cfg = embeddingConfig();
  console.log(`Embeddings: ${cfg.provider}${cfg.model ? ` (${cfg.model} v${cfg.version})` : ""}`);
  if (args.includes("--rebuild")) {
    const orgs = orgArg ? [orgArg] : (await prisma.organization.findMany({ select: { id: true } })).map((o) => o.id);
    for (const id of orgs) console.log(`Queued ${(await rebuildOrganization(id)).queued} records for ${id}`);
  }
  let total = 0;
  for (;;) { const n = await runIndexingJobs({ max: 50 }); total += n; if (!n) break; }
  const failed = await prisma.aiIndexingJob.count({ where: { status: "Failed" } });
  console.log(`Processed ${total} indexing jobs${failed ? ` (${failed} failed — see AI Copilot index status)` : ""}.`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  process.exit(); // imported modules hold Redis connections open
}
