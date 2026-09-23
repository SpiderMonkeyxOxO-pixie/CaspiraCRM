import { PrismaClient } from "@prisma/client";

// Single shared Prisma client instance for the whole process.
//
// Interactive transactions default to a 5s limit, which multi-step writes
// (quote/order totals, pipeline seeding) can exceed when every query
// crosses a slow link — e.g. development against the VPS database through
// an SSH tunnel. 30s leaves room for that without changing behaviour when
// the database is close by.
const prisma = new PrismaClient({
  transactionOptions: { timeout: 30000, maxWait: 10000 },
});

export default prisma;
