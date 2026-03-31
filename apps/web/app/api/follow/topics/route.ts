import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { TopicCreateSchema } from "@/app/api/_utils/zod";
import { logger } from "@/lib/logger";
import { z } from "zod";

const prismaAny = prisma as any;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeRelations = searchParams.get("includeRelations") === "true";

    const topics = await prismaAny.topic.findMany({
      include: includeRelations
        ? {
            terms: true,
            _count: {
              select: {
                terms: true,
              },
            },
          }
        : undefined,
      orderBy: {
        updatedAt: "desc",
      },
    });

    return NextResponse.json(
      topics.map((topic: any) => ({
        ...topic,
        termsCount: topic?._count?.terms ?? 0,
      }))
    );
  } catch (error) {
    logger.error("failed to list topics", {
      error: logger.normalizeError(error),
    });
    return NextResponse.json({ error: "Failed to list topics" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const parsed = TopicCreateSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid topic payload", details: z.flattenError(parsed.error) },
        { status: 400 }
      );
    }

    const data = parsed.data;

    const created = await prismaAny.$transaction(async (tx: any) => {
      const topic = await tx.topic.create({
        data: {
          name: data.name,
          description: data.description ?? null,
          profile: data.profile ?? null,
        },
      });

      if (data.terms.length > 0) {
        await tx.topicTerm.createMany({
          data: data.terms.map((term) => ({
            topicId: topic.id,
            type: term.type,
            value: term.value.trim().toLowerCase(),
            weight: term.weight,
            meta: term.meta ?? null,
          })),
          skipDuplicates: true,
        });
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

    return NextResponse.json(
      {
        ...created,
        termsCount: created?._count?.terms ?? 0,
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error("failed to create topic", {
      error: logger.normalizeError(error),
    });
    return NextResponse.json({ error: "Failed to create topic" }, { status: 500 });
  }
}
