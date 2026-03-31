import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import type {
  Prisma,
  Content,
  ContentSubjectMatch,
  ContentSubjectMatchSource,
  ContentTopicScore,
  ContentEntity,
} from "@/app/generated/prisma";
import { buildRecordContentViews } from "@/lib/follow-content/record-content-view";
const prismaAny = prisma as any;

const contentTypeSchema = z.enum(["Web", "Client", "Darknet"]);
const matchSourceSchema = z.enum(["QUERY", "GATHER", "AI", "FUSED"]);
const sortSchema = z.enum(["time", "relevance", "matchScore", "topicScore"]);
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
  includeEntities: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  includeFeedback: z
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
    entities?: ContentEntity | null;
    topicFeedbacks?: Array<{
      vote: "UP" | "DOWN" | "NONE";
      note: string | null;
      topicId: string;
    }>;
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
    topicScore: item.topicScores?.[0]
      ? {
          topicId: item.topicScores[0].topicId,
          finalScore: item.topicScores[0].finalScore,
        }
      : null,
    entities: item.entities
      ? {
          persons: item.entities.persons ?? [],
          orgs: item.entities.orgs ?? [],
          locations: item.entities.locations ?? [],
        }
      : null,
    feedback: item.topicFeedbacks?.[0]
      ? {
          topicId: item.topicFeedbacks[0].topicId,
          vote: item.topicFeedbacks[0].vote,
          note: item.topicFeedbacks[0].note,
        }
      : null,
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
    includeEntities,
    includeFeedback,
    cursor,
    limit,
  } = parsed.data;
  const topicIds = Array.from(
    new Set(
      url.searchParams
        .getAll("topicId")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
  const effectiveTopicIds = topicIds.length ? topicIds : topicId ? [topicId] : [];
  const feedbackTopicId = effectiveTopicIds[0];
  const userId = request.headers.get("x-user-id")?.trim() || process.env.DEFAULT_USER_ID || "default-user-id";

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

  if (effectiveTopicIds.length || minTopicScore != null) {
    where.topicScores = {
      some: {
        ...(effectiveTopicIds.length
          ? { topicId: { in: effectiveTopicIds } }
          : {}),
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
    includeTopicScores || effectiveTopicIds.length > 0 || minTopicScore != null
      ? {
          topicScores: {
            where: {
              ...(effectiveTopicIds.length
                ? { topicId: { in: effectiveTopicIds } }
                : {}),
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
  const includeEntityRelation = includeEntities
    ? { entities: true as const }
    : { entities: false as const };
  const includeFeedbackRelation =
    includeFeedback && feedbackTopicId
      ? {
          topicFeedbacks: {
            where: {
              topicId: feedbackTopicId,
              userId,
            },
            take: 1,
            orderBy: { updatedAt: "desc" as const },
          },
        }
      : {};

  const contents = await prismaAny.content.findMany({
    where,
    orderBy: { time: "desc" },
    take: limit + 1,
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
    include: {
      ...includeSubjectMatchRelation,
      ...includeTopicScoreRelation,
      ...includeEntityRelation,
      ...includeFeedbackRelation,
    },
  });

  const hasMore = contents.length > limit;
  const nextCursor = hasMore ? contents[limit].id : null;
  const pageItems = hasMore ? contents.slice(0, limit) : contents;
  const sortedItems =
    (sort === "matchScore" && subjectId)
      ? [...pageItems].sort((left, right) => {
          const leftScore = left.subjectMatches?.[0]?.matchScore ?? -1;
          const rightScore = right.subjectMatches?.[0]?.matchScore ?? -1;
          return rightScore - leftScore;
        })
      : (sort === "topicScore" || sort === "relevance")
        ? [...pageItems].sort((left, right) => {
            const leftScore = Math.max(
              ...(left.topicScores ?? [])
                .filter((score: any) =>
                  effectiveTopicIds.length
                    ? effectiveTopicIds.includes(score.topicId)
                    : true
                )
                .map((score: any) => score.finalScore ?? -1),
              -1
            );
            const rightScore = Math.max(
              ...(right.topicScores ?? [])
                .filter((score: any) =>
                  effectiveTopicIds.length
                    ? effectiveTopicIds.includes(score.topicId)
                    : true
                )
                .map((score: any) => score.finalScore ?? -1),
              -1
            );
            return rightScore - leftScore;
          })
      : pageItems;
  const items = sortedItems.map((item: any) => mapContent(item));

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
