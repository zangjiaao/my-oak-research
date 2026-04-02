import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

import { Pool } from "pg";

const directUrl = process.env.DIRECT_URL ?? "";
const isLocalDatabase =
  directUrl.includes("localhost") || directUrl.includes("127.0.0.1");

const pool = new Pool({
  connectionString: directUrl,
  ssl: isLocalDatabase
    ? undefined
    : {
        rejectUnauthorized: false,
      },
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
});

async function main() {
  await prisma.$queryRaw`SELECT 1`;
  console.log("Seed completed");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
