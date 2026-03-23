import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { scheduleQueryCollect, unscheduleQueryCollect } from "@/lib/queue";
import { QueryUpdateSchema } from "@/app/api/_utils/zod";
import { logger } from "@/lib/logger";
import { z } from "zod";
import { Prisma } from "@/app/generated/prisma";

export async function GET(
  req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  const query = await prisma.query.findUnique({
    where: { id: params.id },
    include: {
      keywords: true,
      sources: true,
      sourcePolicies: true,
      _count: {
        select: {
          keywords: true,
          sources: true,
        },
      },
    },
  });

  if (!query) {
    return new NextResponse("Query not found", { status: 404 });
  }

  const queryWithCounts = {
    ...query,
    keywordsCount: query._count?.keywords || 0,
    sourcesCount: query._count?.sources || 0,
    _count: undefined,
  };

  return NextResponse.json(queryWithCounts);
}

export async function PATCH(
  req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  const existing = await prisma.query.findUnique({
    where: { id: params.id },
    include: {
      keywords: { select: { id: true } },
      sources: { select: { id: true } },
      sourcePolicies: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Query not found" }, { status: 404 });
  }

  const payload = await req.json();
  const parsed = QueryUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query payload", details: z.flattenError(parsed.error) },
      { status: 400 }
    );
  }
  const data = parsed.data;
  const keywordIds = data.keywordIds;
  const sourceIds = data.sourceIds;
  const sourcePoliciesInput = data.sourcePolicies;
  const finalSourceIds = sourceIds ?? existing.sources.map((source) => source.id);
  const sourcePoliciesMap = new Map(
    (sourcePoliciesInput ?? []).map((item) => [item.sourceId, item])
  );

  // Validate keywordIds
  if (keywordIds && keywordIds.length > 0) {
    const existingKeywords = await prisma.keyword.count({
      where: { id: { in: keywordIds } },
    });
    if (existingKeywords !== keywordIds.length) {
      return NextResponse.json(
        { error: "One or more provided keywordIds do not exist." },
        { status: 400 }
      );
    }
  }

  // Validate sourceIds
  if (sourceIds && sourceIds.length > 0) {
    const existingSources = await prisma.source.count({
      where: { id: { in: sourceIds } },
    });
    if (existingSources !== sourceIds.length) {
      return NextResponse.json(
        { error: "One or more provided sourceIds do not exist." },
        { status: 400 }
      );
    }
  }

  const sourcePolicySourceIds = Array.from(sourcePoliciesMap.keys());
  if (sourcePolicySourceIds.length > 0) {
    const existingPolicySources = await prisma.source.count({
      where: { id: { in: sourcePolicySourceIds } },
    });
    if (existingPolicySources !== sourcePolicySourceIds.length) {
      return NextResponse.json(
        { error: "One or more provided sourcePolicies.sourceId do not exist." },
        { status: 400 }
      );
    }
  }

  if (sourcePolicySourceIds.some((sourceId) => !finalSourceIds.includes(sourceId))) {
    return NextResponse.json(
      { error: "sourcePolicies.sourceId must be selected in sourceIds." },
      { status: 400 }
    );
  }

  const query = await prisma.$transaction(async (tx) => {
    const updated = await tx.query.update({
      where: { id: params.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description ?? null } : {}),
        ...(data.frequency !== undefined ? { frequency: data.frequency } : {}),
        ...(data.frequency !== undefined
          ? { cronSchedule: data.frequency === "CRONTAB" ? (data.cronSchedule ?? null) : null }
          : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.rules !== undefined ? { rules: data.rules } : {}),
        ...(keywordIds !== undefined
          ? {
              keywords: {
                set: keywordIds.map((id) => ({ id })),
              },
            }
          : {}),
        ...(sourceIds !== undefined
          ? {
              sources: {
                set: sourceIds.map((id) => ({ id })),
              },
            }
          : {}),
      },
    });

    if (sourceIds !== undefined) {
      await tx.querySourcePolicy.deleteMany({
        where: {
          queryId: params.id,
          NOT: {
            sourceId: {
              in: sourceIds,
            },
          },
        },
      });
    }

    if (sourcePoliciesInput !== undefined) {
      if (sourceIds !== undefined) {
        await tx.querySourcePolicy.deleteMany({
          where: {
            queryId: params.id,
            sourceId: {
              in: sourceIds,
            },
            NOT: {
              sourceId: {
                in: sourcePolicySourceIds,
              },
            },
          },
        });
      }
      for (const item of sourcePoliciesMap.values()) {
        await tx.querySourcePolicy.upsert({
          where: {
            queryId_sourceId: {
              queryId: params.id,
              sourceId: item.sourceId,
            },
          },
          create: {
            queryId: params.id,
            sourceId: item.sourceId,
            contentFilterEnabled: item.contentFilterEnabled,
            contentFilterMode: item.contentFilterMode,
          },
          update: {
            contentFilterEnabled: item.contentFilterEnabled,
            contentFilterMode: item.contentFilterMode,
          },
        });
      }
    }

    return updated;
  });

  try {
    await scheduleQueryCollect({
      queryId: query.id,
      frequency: query.frequency,
      cronSchedule: query.cronSchedule,
      enabled: query.enabled,
    });
  } catch (error) {
    logger.error("failed to schedule query after update, rolling back", {
      queryId: query.id,
      error: logger.normalizeError(error),
    });
    await prisma.query.update({
      where: { id: params.id },
      data: {
        name: existing.name,
        description: existing.description,
        frequency: existing.frequency,
        cronSchedule: existing.cronSchedule,
        enabled: existing.enabled,
        rules: existing.rules === null ? Prisma.JsonNull : existing.rules,
        keywords: {
          set: existing.keywords.map((keyword) => ({ id: keyword.id })),
        },
        sources: {
          set: existing.sources.map((source) => ({ id: source.id })),
        },
      },
    });
    await prisma.querySourcePolicy.deleteMany({
      where: { queryId: params.id },
    });
    if (existing.sourcePolicies.length > 0) {
      await prisma.querySourcePolicy.createMany({
        data: existing.sourcePolicies.map((item) => ({
          queryId: item.queryId,
          sourceId: item.sourceId,
          contentFilterEnabled: item.contentFilterEnabled,
          contentFilterMode: item.contentFilterMode,
        })),
      });
    }
    await scheduleQueryCollect({
      queryId: existing.id,
      frequency: existing.frequency,
      cronSchedule: existing.cronSchedule,
      enabled: existing.enabled,
    }).catch((rollbackScheduleError) => {
      logger.error("failed to restore previous query schedule", {
        queryId: existing.id,
        error: logger.normalizeError(rollbackScheduleError),
      });
    });
    return NextResponse.json(
      { error: "Failed to schedule query task update" },
      { status: 503 }
    );
  }

  return NextResponse.json(query);
}

export async function DELETE(
  req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  await unscheduleQueryCollect(params.id);
  await prisma.query.delete({
    where: { id: params.id },
  });
  return NextResponse.json({ success: true });
}
