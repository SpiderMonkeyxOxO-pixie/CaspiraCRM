// npm run analytics -- <command> [--org <organizationId>]
//   seed      Seed/version the governed metric registry and refresh each
//             organization's analytics calendar (time zone, base currency,
//             fiscal year). Safe to run repeatedly.
//   backfill  Queue a full load of every warehouse source and snapshot, then
//             run the queue to completion (what the worker does incrementally).
//   run       Run whatever jobs are already queued.
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { seedMetrics } from "../src/analytics/metrics/registry.js";
import { refreshCalendar } from "../src/analytics/common/calendar.js";
import { ALL_SOURCES, SNAPSHOT_SOURCES, enqueueWarehouseJob, claimNextJob, runJob, refreshMaterializedViews } from "../src/analytics/warehouse/jobs.js";

const args = process.argv.slice(2);
const command = args[0] || "seed";
const orgArg = args.includes("--org") ? args[args.indexOf("--org") + 1] : null;
try {
  const orgs = orgArg ? [orgArg] : (await prisma.organization.findMany({ select: { id: true } })).map((o) => o.id);
  if (command === "seed") {
    console.log("Metrics:", await seedMetrics());
    for (const id of orgs) { const c = await refreshCalendar(id); console.log(`Calendar ${id}: ${c.timeZone}, ${c.baseCurrency}, fiscal year starts month ${c.fiscalYearStartMonth}`); }
  } else if (command === "backfill" || command === "run") {
    if (command === "backfill") {
      for (const id of orgs) for (const s of ALL_SOURCES) await enqueueWarehouseJob(id, s, SNAPSHOT_SOURCES.includes(s) ? "manual" : "backfill");
    }
    let job;
    while ((job = await claimNextJob())) {
      const done = await runJob(job);
      console.log(`${done.source.padEnd(15)} ${done.status.padEnd(24)} read ${done.rowsRead}, inserted ${done.rowsInserted}, updated ${done.rowsUpdated}, rejected ${done.rowsRejected}${done.safeError ? ` — ${done.safeError}` : ""}`);
    }
    console.log("Views:", await refreshMaterializedViews());
  } else {
    console.error(`Unknown command ${command}. Use seed, backfill or run.`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  process.exit(); // imported modules hold Redis connections open
}
