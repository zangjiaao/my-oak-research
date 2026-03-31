import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";

const prismaAny = prisma as any;

const AddTopicTermSchema = z.object({
  value: z.string().min(1).max(128),
  type: z.enum(["CORE", "EXPANSION", "EXCLUSION"]).optional().default("EXPANSION"),
  weight: z.number().min(0).max(5).optional().default(1),
  meta: z.any().optional().nullable(),
});

export async function POST(
  req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  try {
    const payload = await req.json();
    const parsed = AddTopicTermSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid term payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const topic = await prismaAny.topic.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!topic) {
      return NextResponse.json({ error: "Topic not found" }, { status: 404 });
    }

    const value = parsed.data.value.trim().toLowerCase();
    const created = await prismaAny.topicTerm.upsert({
      where: {
        topicId_type_value: {
          topicId: params.id,
          type: parsed.data.type,
          value,
        },
      },
      update: {
        weight: parsed.data.weight,
        meta: parsed.data.meta ?? null,
      },
      create: {
        topicId: params.id,
        type: parsed.data.type,
        value,
        weight: parsed.data.weight,
        meta: parsed.data.meta ?? null,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    logger.error("failed to add topic term", {
      topicId: params.id,
      error: logger.normalizeError(error),
    });
    return NextResponse.json({ error: "Failed to add topic term" }, { status: 500 });
  }
}
