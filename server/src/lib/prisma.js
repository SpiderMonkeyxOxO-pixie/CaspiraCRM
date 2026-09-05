import { PrismaClient } from "@prisma/client";

// Single shared Prisma client instance for the whole process.
const prisma = new PrismaClient();

export default prisma;
