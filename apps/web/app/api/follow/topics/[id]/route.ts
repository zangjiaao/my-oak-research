import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { TopicUpdateSchema } from "@/app/api/_utils/zod";
import { logger } from "@/lib/logger";
import { z } from "zod";
import { refreshTopicVector } from "@/lib/topic-vector";
import { scheduleTopicRescore } from "@/lib/queue";
import { refreshTopicTermsAuto } from "@/lib/topic-terms-auto";

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
    const payloadObject =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    const hasTermsInPayload = Object.prototype.hasOwnProperty.call(
      payloadObject,
      "terms"
    );
    const inputTerms = data.terms ?? [];
    const shouldAutoRefreshTerms = !hasTermsInPayload || inputTerms.length === 0;

    const updated = await prismaAny.$transaction(async (tx: any) => {
      const topic = await tx.topic.update({
        where: { id: params.id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description ?? null } : {}),
          ...(data.profile !== undefined ? { profile: data.profile ?? null } : {}),
        },
      });

      if (hasTermsInPayload) {
        await tx.topicTerm.deleteMany({
          where: {
            topicId: params.id,
          },
        });
        if (inputTerms.length > 0) {
          await tx.topicTerm.createMany({
            data: inputTerms.map((term) => ({
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

    let vectorRefreshed = false;
    try {
      await refreshTopicVector(prismaAny, params.id);
      vectorRefreshed = true;
    } catch (error) {
      logger.warn("topic vector refresh failed", {
        topicId: params.id,
        error: logger.normalizeError(error),
      });
    }

    let rescoreScheduled = false;
    let rescoreJobId: string | null = null;
    try {
      const scheduled = await scheduleTopicRescore({
        topicId: params.id,
        trigger: "topic-update",
      });
      rescoreScheduled = scheduled.scheduled;
      rescoreJobId = scheduled.jobId;
    } catch (error) {
      logger.warn("topic rescore schedule failed", {
        topicId: params.id,
        error: logger.normalizeError(error),
      });
    }

    let autoTermsResult = {
      autoTermsUpdated: false,
      autoTermsCount: 0,
      vectorRefreshed: false,
      rescoreScheduled: false,
      rescoreJobId: null as string | null,
      autoTermsReason: null as string | null,
    };
    if (shouldAutoRefreshTerms) {
      autoTermsResult = await refreshTopicTermsAuto({
        prismaAny,
        topicId: params.id,
        trigger: "topic-update",
      });
    }

    const finalVectorRefreshed = autoTermsResult.autoTermsUpdated
      ? autoTermsResult.vectorRefreshed
      : vectorRefreshed;
    const finalRescoreScheduled = autoTermsResult.autoTermsUpdated
      ? autoTermsResult.rescoreScheduled
      : rescoreScheduled;
    const finalRescoreJobId = autoTermsResult.autoTermsUpdated
      ? autoTermsResult.rescoreJobId
      : rescoreJobId;

    return NextResponse.json({
      ...updated,
      termsCount: updated?._count?.terms ?? 0,
      vectorRefreshed: finalVectorRefreshed,
      rescoreScheduled: finalRescoreScheduled,
      rescoreJobId: finalRescoreJobId,
      autoTermsUpdated: autoTermsResult.autoTermsUpdated,
      autoTermsCount: autoTermsResult.autoTermsCount,
      autoTermsReason: autoTermsResult.autoTermsReason,
      autoTermsVectorRefreshed: autoTermsResult.vectorRefreshed,
      autoTermsRescoreScheduled: autoTermsResult.rescoreScheduled,
      autoTermsRescoreJobId: autoTermsResult.rescoreJobId,
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
    const exists = await prismaAny.topic.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!exists) {
      return NextResponse.json({ error: "Topic not found" }, { status: 404 });
    }

    await prismaAny.$transaction(async (tx: any) => {
      await tx.jobTopic.deleteMany({
        where: { topicId: params.id },
      });
      await tx.topicSource.deleteMany({
        where: { topicId: params.id },
      });
      await tx.contentTopicScore.deleteMany({
        where: { topicId: params.id },
      });
      await tx.topicTerm.deleteMany({
        where: { topicId: params.id },
      });
      await tx.topic.delete({
        where: { id: params.id },
      });
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
