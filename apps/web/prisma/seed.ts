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
  const categories = [
    { name: "Person", description: "Default category for person" },
    { name: "Event", description: "Default category for event" },
    { name: "Organization", description: "Default category for organization" },
    { name: "Location", description: "Default category for location" },
  ];

  for (const c of categories) {
    await prisma.category.upsert({
      where: { name: c.name },
      update: {},
      create: c,
    });
  }

  console.log("Categories seeded");
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
