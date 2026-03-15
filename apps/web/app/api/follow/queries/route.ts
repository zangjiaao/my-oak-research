import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { scheduleQueryCollect } from "@/lib/queue";
import { QueryCreateSchema } from "@/app/api/_utils/zod";
import { logger } from "@/lib/logger";
import { z } from "zod";

type QueryRow = Awaited<ReturnType<typeof prisma.query.findMany>> extends Array<
  infer R
>
  ? R
  : never;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const includeKeywordsAndSources =
    searchParams.get("includeKeywordsAndSources") === "true";

  const queries = await prisma.query.findMany({
    include: includeKeywordsAndSources
      ? {
          keywords: true,
          sources: true,
          _count: {
            select: {
              keywords: true,
              sources: true,
            },
          },
          queryRuns: {
            orderBy: {
              createdAt: "desc",
            },
            take: 1,
          },
        }
      : undefined,
    orderBy: {
      updatedAt: "desc",
    },
  });

  // Manually map to include the counts directly on the query object
  const queriesWithCounts = queries.map((query) => {
    if (includeKeywordsAndSources) {
      const { _count, keywords, sources, queryRuns, ...rest } =
        query as QueryRow & {
          keywords?: unknown[];
          sources?: unknown[];
          _count?: { keywords?: number; sources?: number };
          queryRuns?: { id: string; status: string; progress: number }[];
        };
      return {
        ...rest,
        keywords: keywords || [],
        sources: sources || [],
        keywordsCount: _count?.keywords || 0,
        sourcesCount: _count?.sources || 0,
        latestRun: queryRuns?.[0] ?? null,
      };
    }

    return query;
  });
  return NextResponse.json(queriesWithCounts);
}

export async function POST(req: Request) {
  const payload = await req.json();
  const parsed = QueryCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query payload", details: z.flattenError(parsed.error) },
      { status: 400 }
    );
  }
  const data = parsed.data;
  const { keywordIds, sourceIds } = data;

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

  const query = await prisma.query.create({
    data: {
      name: data.name,
      description: data.description ?? null,
      frequency: data.frequency,
      cronSchedule: data.frequency === "CRONTAB" ? data.cronSchedule ?? null : null,
      enabled: data.enabled,
      rules: data.rules,
      keywords: {
        connect: keywordIds.map((id) => ({ id })),
      },
      sources: {
        connect: sourceIds.map((id) => ({ id })),
      },
    },
  });

  try {
    await scheduleQueryCollect({
      queryId: query.id,
      frequency: query.frequency,
      cronSchedule: query.cronSchedule,
      enabled: query.enabled,
    });
  } catch (error) {
    await prisma.query.delete({ where: { id: query.id } }).catch(() => undefined);
    logger.error("failed to schedule query after create", {
      queryId: query.id,
      error: logger.normalizeError(error),
    });
    return NextResponse.json(
      { error: "Failed to schedule query task" },
      { status: 503 }
    );
  }

  return NextResponse.json(query);
}
