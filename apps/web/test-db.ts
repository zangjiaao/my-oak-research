import { PrismaClient } from "./app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

async function test() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    console.log("Testing Instagram Source creation...");
    const base = await prisma.source.create({
      data: {
        name: "Test Instagram " + Date.now(),
        type: "SOCIAL_MEDIA",
        active: true,
      }
    });
    console.log("Base source created:", base.id);

    const config = await prisma.socialMediaSourceConfig.create({
      data: {
        sourceId: base.id,
        platform: "INSTAGRAM" as any,
        config: { username: "testuser" },
      }
    });
    console.log("Config created:", config.sourceId);

    // Cleanup
    await prisma.socialMediaSourceConfig.delete({ where: { sourceId: base.id } });
    await prisma.source.delete({ where: { id: base.id } });
    console.log("Test success and cleaned up.");
  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    await pool.end();
  }
}

test();
