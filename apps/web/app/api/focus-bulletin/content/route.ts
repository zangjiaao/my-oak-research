import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import type {
  Prisma,
  Content,
  ContentSubjectMatch,
  ContentSubjectMatchSource,
  ContentTopicScore,
} from "@/app/generated/prisma";
import { buildRecordContentViews } from "@/lib/follow-content/record-content-view";

const contentTypeSchema = z.enum(["Web", "Client", "Darknet"]);
const matchSourceSchema = z.enum(["QUERY", "GATHER", "AI", "FUSED"]);
const sortSchema = z.enum(["time", "matchScore", "topicScore"]);
const ContentQuerySchema = z.object({
  platform: z.string().trim().min(1).optional(),
  type: contentTypeSchema.optional(),
  search: z.string().trim().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  subjectId: z.string().min(1).optional(),
  minMatchScore: z.coerce.number().min(0).max(1).optional(),
  topicId: z.string().min(1).optional(),
  minTopicScore: z.coerce.number().min(0).optional(),
  matchSource: matchSourceSchema.optional(),
  sort: sortSchema.optional().default("time"),
  includeSubjectMatches: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  includeTopicScores: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const mapContent = (
  item: Content & {
    image?: string | null;
    subjectMatches?: ContentSubjectMatch[];
    topicScores?: ContentTopicScore[];
  }
) => {
  const views = buildRecordContentViews(item);
  return {
    id: item.id,
    title: views.summaryView.title,
    summary: views.summaryView.summary,
    markdown: views.detailView.markdown,
    platform: item.platform,
    time: views.summaryView.ingestedAt,
    url: views.detailView.sourceUrl ?? item.url,
    image: views.detailView.images[0] ?? item.image ?? null,
    type: item.type,
    summaryView: views.summaryView,
    detailView: views.detailView,
    relation: views.relation,
    rawRecordContent: views.rawRecordContent,
    media: views.media ?? [],
    subjectMatches: (item.subjectMatches ?? []).map((match) => ({
      subjectId: match.keywordId,
      ruleScore: match.ruleScore,
      aiScore: match.aiScore,
      score: match.matchScore,
      matchedIncludes: match.matchedIncludes,
      matchedExcludes: match.matchedExcludes,
      matchSource: match.matchSource,
      reason: match.reason,
    })),
    topicScores: (item.topicScores ?? []).map((score) => ({
      topicId: score.topicId,
      vectorScore: score.vectorScore,
      keywordScore: score.keywordScore,
      exclusionPenalty: score.exclusionPenalty,
      finalScore: score.finalScore,
      reason: score.reason,
    })),
  };
};

type ContentResponse = {
  items: ReturnType<typeof mapContent>[];
  nextCursor: string | null;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = ContentQuerySchema.safeParse(
    Object.fromEntries(url.searchParams.entries())
  );

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid query parameters",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const {
    platform,
    type: contentType,
    search,
    from,
    to,
    subjectId,
    minMatchScore,
    topicId,
    minTopicScore,
    matchSource,
    sort,
    includeSubjectMatches,
    includeTopicScores,
    cursor,
    limit,
  } = parsed.data;

  const where: Prisma.ContentWhereInput = {};

  if (platform) {
    where.platform = platform;
  }

  if (contentType) {
    where.type = contentType;
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { summary: { contains: search, mode: "insensitive" } },
    ];
  }

  if (from || to) {
    where.time = {};
    if (from) {
      where.time.gte = new Date(from);
    }
    if (to) {
      where.time.lte = new Date(to);
    }
  }

  let resolvedMinMatchScore = minMatchScore;
  if (subjectId && resolvedMinMatchScore == null) {
    resolvedMinMatchScore = await resolveDefaultMinMatchScore(subjectId);
  }

  if (subjectId || resolvedMinMatchScore != null || matchSource) {
    where.subjectMatches = {
      some: {
        ...(subjectId ? { keywordId: subjectId } : {}),
        ...(resolvedMinMatchScore != null
          ? { matchScore: { gte: resolvedMinMatchScore } }
          : {}),
        ...(matchSource
          ? { matchSource: matchSource as ContentSubjectMatchSource }
          : {}),
      },
    };
  }

  if (topicId || minTopicScore != null) {
    where.topicScores = {
      some: {
        ...(topicId ? { topicId } : {}),
        ...(minTopicScore != null ? { finalScore: { gte: minTopicScore } } : {}),
      },
    };
  }

  const includeSubjectMatchRelation =
    includeSubjectMatches || subjectId || resolvedMinMatchScore != null || matchSource
      ? {
          subjectMatches: {
            where: {
              ...(subjectId ? { keywordId: subjectId } : {}),
              ...(resolvedMinMatchScore != null
                ? { matchScore: { gte: resolvedMinMatchScore } }
                : {}),
              ...(matchSource
                ? { matchSource: matchSource as ContentSubjectMatchSource }
                : {}),
            },
            orderBy: { matchScore: "desc" as const },
          },
        }
      : {
          subjectMatches: {
            take: 0,
          },
        };
  const includeTopicScoreRelation =
    includeTopicScores || topicId || minTopicScore != null
      ? {
          topicScores: {
            where: {
              ...(topicId ? { topicId } : {}),
              ...(minTopicScore != null ? { finalScore: { gte: minTopicScore } } : {}),
            },
            orderBy: { finalScore: "desc" as const },
          },
        }
      : {
          topicScores: {
            take: 0,
          },
        };

  const contents = await prisma.content.findMany({
    where,
    orderBy: { time: "desc" },
    take: limit + 1,
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
    include: {
      ...includeSubjectMatchRelation,
      ...includeTopicScoreRelation,
    },
  });

  const hasMore = contents.length > limit;
  const nextCursor = hasMore ? contents[limit].id : null;
  const pageItems = hasMore ? contents.slice(0, limit) : contents;
  const sortedItems =
    sort === "matchScore" && subjectId
      ? [...pageItems].sort((left, right) => {
          const leftScore = left.subjectMatches?.[0]?.matchScore ?? -1;
          const rightScore = right.subjectMatches?.[0]?.matchScore ?? -1;
          return rightScore - leftScore;
        })
      : sort === "topicScore" && topicId
        ? [...pageItems].sort((left, right) => {
            const leftScore = left.topicScores?.[0]?.finalScore ?? -1;
            const rightScore = right.topicScores?.[0]?.finalScore ?? -1;
            return rightScore - leftScore;
          })
      : pageItems;
  const items = sortedItems.map((item) => mapContent(item));

  const response: ContentResponse = {
    items,
    nextCursor,
  };

  return NextResponse.json(response);
}

async function resolveDefaultMinMatchScore(subjectId: string): Promise<number> {
  const windowStart = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const samples = await prisma.contentSubjectMatch.findMany({
    where: {
      keywordId: subjectId,
      createdAt: { gte: windowStart },
      matchScore: { not: null },
    },
    select: { matchScore: true },
    orderBy: { matchScore: "asc" },
    take: 1000,
  });

  if (samples.length < 50) {
    return 0.35;
  }
  const scores = samples
    .map((sample) => sample.matchScore)
    .filter((score): score is number => typeof score === "number");
  if (scores.length === 0) return 0.35;
  const percentileIndex = Math.min(
    scores.length - 1,
    Math.max(0, Math.floor(scores.length * 0.65))
  );
  return scores[percentileIndex] ?? 0.35;
}
