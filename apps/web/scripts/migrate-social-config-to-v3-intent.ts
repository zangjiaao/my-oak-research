import path from "node:path";

import prisma from "../lib/prisma";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

function inferIntentType(config: JsonObject): string {
  const rawIntent = asObject(config.intent);
  if (typeof rawIntent.type === "string" && rawIntent.type.trim()) {
    return rawIntent.type.trim();
  }

  const playwright = asObject(config.playwright);
  const mode =
    typeof playwright.mode === "string" ? playwright.mode.trim().toLowerCase() : "";
  if (mode.startsWith("intercept-")) {
    const match = mode.match(/^intercept-[^-]+-(.+)$/);
    if (match?.[1]) return match[1];
  }

  const scriptPath =
    typeof playwright.scriptPath === "string" ? playwright.scriptPath.trim() : "";
  if (scriptPath) {
    const base = path.basename(scriptPath).replace(/\.(js|ts)$/i, "");
    if (base) return base;
  }

  return "search";
}

function inferIntentArgs(config: JsonObject): JsonObject {
  const rawIntent = asObject(config.intent);
  const intentArgs = asObject(rawIntent.args);
  if (Object.keys(intentArgs).length > 0) return intentArgs;

  const playwright = asObject(config.playwright);
  const playwrightArgs = asObject(playwright.args);
  if (Object.keys(playwrightArgs).length > 0) return playwrightArgs;

  const legacyKeys = [
    "query",
    "userId",
    "noteId",
    "videoId",
    "username",
    "postId",
    "subreddit",
    "sort",
    "chatId",
    "maxResults",
    "contactName",
    "hotTopics",
  ];

  const output: JsonObject = {};
  for (const key of legacyKeys) {
    if (config[key] !== undefined && config[key] !== null && config[key] !== "") {
      output[key] = config[key];
    }
  }
  return output;
}

function buildNextConfig(config: JsonObject): JsonObject {
  const next = { ...config };
  const playwright = asObject(next.playwright);
  const intent = {
    type: inferIntentType(next),
    args: inferIntentArgs(next),
  };

  const nextPlaywright = { ...playwright };
  delete nextPlaywright.scriptPath;
  delete nextPlaywright.args;
  if (Object.keys(nextPlaywright).length > 0) {
    next.playwright = nextPlaywright;
  } else {
    delete next.playwright;
  }

  delete next.query;
  delete next.userId;
  delete next.noteId;
  delete next.videoId;
  delete next.username;
  delete next.postId;
  delete next.subreddit;
  delete next.sort;
  delete next.chatId;
  delete next.maxResults;
  delete next.contactName;
  delete next.hotTopics;

  next.intent = intent;
  return next;
}

async function main() {
  const rows = await prisma.socialMediaSourceConfig.findMany({
    select: {
      sourceId: true,
      platform: true,
      config: true,
    },
  });

  let updated = 0;
  let skipped = 0;
  const migrated: Array<{ sourceId: string; platform: string; intentType: string }> = [];

  for (const row of rows) {
    const config = asObject(row.config);
    const nextConfig = buildNextConfig(config);
    const previousJson = JSON.stringify(config);
    const nextJson = JSON.stringify(nextConfig);
    if (previousJson === nextJson) {
      skipped += 1;
      continue;
    }

    await prisma.socialMediaSourceConfig.update({
      where: { sourceId: row.sourceId },
      data: { config: nextConfig },
    });
    updated += 1;
    migrated.push({
      sourceId: row.sourceId,
      platform: row.platform,
      intentType: asObject(nextConfig.intent).type as string,
    });
  }

  console.log(
    JSON.stringify(
      {
        total: rows.length,
        updated,
        skipped,
        migrated,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("[migrate-social-config-to-v3-intent] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
