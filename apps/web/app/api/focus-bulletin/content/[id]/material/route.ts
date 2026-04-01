import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { Prisma } from "@/app/generated/prisma";

const RequestSchema = z.object({
  content: z.string().trim().min(1).max(200000),
});

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function PATCH(
  req: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  const contentId = params.id;
  if (!contentId) {
    return NextResponse.json({ error: "contentId is required" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const content = await prisma.content.findUnique({
    where: { id: contentId },
    select: { id: true, meta: true },
  });
  if (!content) {
    return NextResponse.json({ error: "Content not found" }, { status: 404 });
  }

  const finalMaterialUpdatedAt = new Date().toISOString();
  const meta = asObject(content.meta);
  const nextMeta: Record<string, unknown> = {
    ...meta,
    finalMaterialContent: parsed.data.content,
    finalMaterialUpdatedAt,
  };

  try {
    await prisma.content.update({
      where: { id: contentId },
      data: {
        meta: nextMeta as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    logger.error("failed to update final material content", {
      contentId,
      error: logger.normalizeError(error),
    });
    return NextResponse.json({ error: "Failed to save material content" }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: {
      contentId,
      content: parsed.data.content,
      updatedAt: finalMaterialUpdatedAt,
    },
  });
}
