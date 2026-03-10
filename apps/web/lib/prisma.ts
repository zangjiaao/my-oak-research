import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

import { Pool } from "pg";

const globalForPrisma = global as unknown as {
  prisma: PrismaClient;
};

const databaseUrl = process.env.DATABASE_URL ?? "";
const isLocalDatabase =
  databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1");

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: isLocalDatabase
    ? undefined
    : {
        rejectUnauthorized: false,
      },
});

const adapter = new PrismaPg(pool);

const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
