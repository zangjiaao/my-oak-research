import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { TopicUpdateSchema } from "@/app/api/_utils/zod";
import { logger } from "@/lib/logger";
import { z } from "zod";

const prismaAny = prisma as any;

export async function GET(
  _req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  const topic = await prismaAny.topic.findUnique({
    where: { id: params.id },
    include: {
      terms: true,
      _count: {
        select: {
          terms: true,
        },
      },
    },
  });

  if (!topic) {
    return new NextResponse("Topic not found", { status: 404 });
  }

  return NextResponse.json({
    ...topic,
    termsCount: topic?._count?.terms ?? 0,
  });
}

export async function PATCH(
  req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  try {
    const existing = await prismaAny.topic.findUnique({
      where: { id: params.id },
      include: {
        terms: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Topic not found" }, { status: 404 });
    }

    const payload = await req.json();
    const parsed = TopicUpdateSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid topic payload", details: z.flattenError(parsed.error) },
        { status: 400 }
      );
    }

    const data = parsed.data;

    const updated = await prismaAny.$transaction(async (tx: any) => {
      const topic = await tx.topic.update({
        where: { id: params.id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description ?? null } : {}),
          ...(data.profile !== undefined ? { profile: data.profile ?? null } : {}),
        },
      });

      if (data.terms !== undefined) {
        await tx.topicTerm.deleteMany({
          where: {
            topicId: params.id,
          },
        });
        if (data.terms.length > 0) {
          await tx.topicTerm.createMany({
            data: data.terms.map((term) => ({
              topicId: params.id,
              type: term.type,
              value: term.value.trim().toLowerCase(),
              weight: term.weight,
              meta: term.meta ?? null,
            })),
            skipDuplicates: true,
          });
        }
      }

      return tx.topic.findUnique({
        where: { id: topic.id },
        include: {
          terms: true,
          _count: {
            select: {
              terms: true,
            },
          },
        },
      });
    });

    return NextResponse.json({
      ...updated,
      termsCount: updated?._count?.terms ?? 0,
    });
  } catch (error) {
    logger.error("failed to update topic", {
      topicId: params.id,
      error: logger.normalizeError(error),
    });
    return NextResponse.json({ error: "Failed to update topic" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  try {
    await prismaAny.topic.delete({
      where: { id: params.id },
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logger.error("failed to delete topic", {
      topicId: params.id,
      error: logger.normalizeError(error),
    });
    return NextResponse.json({ error: "Failed to delete topic" }, { status: 500 });
  }
}
