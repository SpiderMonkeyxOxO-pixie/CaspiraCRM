// npm run db:seed:integrations — idempotent provider catalog seed.
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { seedProviderCatalog } from "../src/integrations/providers/catalogSeed.js";

seedProviderCatalog(prisma)
  .then((r) => console.log(`Provider catalog: ${r.total} providers (${r.created} created, ${r.updated} updated, ${r.unchanged} unchanged).`))
  .catch((err) => { console.error("Provider catalog seed failed:", err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
