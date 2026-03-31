import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { randomUUID } from "node:crypto";

const prismaAny = prisma as any;

const FeedbackPayloadSchema = z.object({
  contentId: z.string().cuid(),
  topicId: z.string().cuid(),
  vote: z.enum(["UP", "DOWN", "NONE"]).optional().default("NONE"),
  note: z.string().max(1000).optional().nullable(),
});

function getUserId(request: Request): string {
  const headerUserId = request.headers.get("x-user-id");
  if (headerUserId?.trim()) return headerUserId.trim();
  return process.env.DEFAULT_USER_ID || "default-user-id";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const topicId = url.searchParams.get("topicId")?.trim();
    const contentIdsRaw = url.searchParams.get("contentIds")?.trim() ?? "";
    const contentIds = Array.from(
      new Set(
        contentIdsRaw
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      )
    );
    const userId = getUserId(request);

    if (!topicId || contentIds.length === 0) {
      return NextResponse.json([]);
    }

    const rows = await prismaAny.$queryRaw`
      SELECT "id", "contentId", "topicId", "userId", "vote", "note", "createdAt", "updatedAt"
      FROM "ContentTopicFeedback"
      WHERE "topicId" = ${topicId}
        AND "userId" = ${userId}
        AND "contentId" = ANY(${contentIds}::text[])
      ORDER BY "updatedAt" DESC
    `;

    return NextResponse.json(rows);
  } catch (error) {
    logger.error("failed to list content feedback", {
      error: logger.normalizeError(error),
    });
    return NextResponse.json(
      { error: "Failed to list content feedback" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = FeedbackPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid feedback payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const userId = getUserId(request);
    const data = parsed.data;
    const now = new Date();

    await prismaAny.$executeRaw`
      INSERT INTO "ContentTopicFeedback"
      ("id", "contentId", "topicId", "userId", "vote", "note", "createdAt", "updatedAt")
      VALUES (${`ctf_${randomUUID()}`}, ${data.contentId}, ${data.topicId}, ${userId}, ${data.vote}::"FeedbackVote", ${data.note ?? null}, ${now}, ${now})
      ON CONFLICT ("contentId", "topicId", "userId")
      DO UPDATE SET
        "vote" = EXCLUDED."vote",
        "note" = EXCLUDED."note",
        "updatedAt" = EXCLUDED."updatedAt"
    `;

    const [row] = await prismaAny.$queryRaw`
      SELECT "id", "contentId", "topicId", "userId", "vote", "note", "createdAt", "updatedAt"
      FROM "ContentTopicFeedback"
      WHERE "contentId" = ${data.contentId}
        AND "topicId" = ${data.topicId}
        AND "userId" = ${userId}
      LIMIT 1
    `;

    return NextResponse.json(row ?? null);
  } catch (error) {
    logger.error("failed to upsert content feedback", {
      error: logger.normalizeError(error),
    });
    return NextResponse.json(
      { error: "Failed to save content feedback" },
      { status: 500 }
    );
  }
}
