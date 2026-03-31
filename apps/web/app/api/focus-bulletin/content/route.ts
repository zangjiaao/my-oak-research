import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import type {
  Prisma,
  Content,
  ContentTopicScore,
  ContentEntity,
} from "@/app/generated/prisma";
import { buildRecordContentViews } from "@/lib/follow-content/record-content-view";
const prismaAny = prisma as any;
const DEFAULT_TOPIC_FILTER_MIN_SCORE = Math.max(
  0,
  Math.min(1, Number(process.env.TOPIC_FILTER_MIN_SCORE ?? 0.4))
);

const contentTypeSchema = z.enum(["Web", "Client", "Darknet"]);
const sortSchema = z.enum(["time", "relevance", "topicScore"]);
const ContentQuerySchema = z.object({
  platform: z.string().trim().min(1).optional(),
  type: contentTypeSchema.optional(),
  search: z.string().trim().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  topicId: z.string().min(1).optional(),
  minTopicScore: z.coerce.number().min(0).optional(),
  sort: sortSchema.optional().default("time"),
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
    topicScores?: ContentTopicScore[];
    entities?: ContentEntity | null;
    topicFeedbacks?: Array<{
      vote: "UP" | "DOWN" | "NONE";
      note: string | null;
      topicId: string;
    }>;
  }
) => {
  const asObject = (value: unknown): Record<string, unknown> => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  };
  const views = buildRecordContentViews(item);
  const meta =
    item.meta && typeof item.meta === "object" && !Array.isArray(item.meta)
      ? (item.meta as Record<string, unknown>)
      : {};
  const aiSummary =
    typeof meta.aiSummary === "string" && meta.aiSummary.trim()
      ? meta.aiSummary.trim()
      : null;
  const aiSummaryUpdatedAt =
    typeof meta.aiSummaryUpdatedAt === "string" ? meta.aiSummaryUpdatedAt : null;
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
    topicScores: (item.topicScores ?? []).map((score) => ({
      ...(() => {
        const explain = asObject(score.explain);
        const llmRerankScoreRaw = explain.llmRerankScore;
        const baseFinalScoreRaw = explain.baseFinalScore;
        const llmRerankWeightRaw = explain.llmRerankWeight;
        const llmRerankForcedAtRaw = explain.llmRerankForcedAt;
        const llmRerankKeywordsRaw = Array.isArray(explain.llmRerankKeywords)
          ? explain.llmRerankKeywords
          : [];
        const llmReranked =
          typeof llmRerankScoreRaw === "number" &&
          Number.isFinite(llmRerankScoreRaw);
        const llmRerankKeywords = llmRerankKeywordsRaw
          .map((item) =>
            item && typeof item === "object" && !Array.isArray(item)
              ? (item as Record<string, unknown>)
              : null
          )
          .filter(Boolean)
          .map((item) => ({
            category: String(item!.category ?? "").trim(),
            label: String(item!.label ?? "").trim(),
          }))
          .filter(
            (item) =>
              [
                "PERSON",
                "ORG",
                "LOCATION",
                "TECH",
                "PRODUCT",
                "EVENT",
                "CONCEPT",
              ].includes(item.category) &&
              item.label.length >= 2 &&
              item.label.length <= 40
          );
        return {
          llmReranked,
          llmRerankScore: llmReranked ? llmRerankScoreRaw : null,
          baseFinalScore:
            typeof baseFinalScoreRaw === "number" &&
            Number.isFinite(baseFinalScoreRaw)
              ? baseFinalScoreRaw
              : null,
          llmRerankWeight:
            typeof llmRerankWeightRaw === "number" &&
            Number.isFinite(llmRerankWeightRaw)
              ? llmRerankWeightRaw
              : null,
          llmRerankForcedAt:
            typeof llmRerankForcedAtRaw === "string" ? llmRerankForcedAtRaw : null,
          llmRerankKeywords,
        };
      })(),
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
    aiSummary,
    aiSummaryUpdatedAt,
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
    topicId,
    minTopicScore,
    sort,
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
  const resolvedMinTopicScore =
    minTopicScore != null
      ? minTopicScore
      : effectiveTopicIds.length
        ? DEFAULT_TOPIC_FILTER_MIN_SCORE
        : undefined;
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

  if (effectiveTopicIds.length || resolvedMinTopicScore != null) {
    where.topicScores = {
      some: {
        ...(effectiveTopicIds.length
          ? { topicId: { in: effectiveTopicIds } }
          : {}),
        ...(resolvedMinTopicScore != null
          ? { finalScore: { gte: resolvedMinTopicScore } }
          : {}),
      },
    };
  }

  const includeTopicScoreRelation =
    includeTopicScores || effectiveTopicIds.length > 0 || resolvedMinTopicScore != null
      ? {
          topicScores: {
            where: {
              ...(effectiveTopicIds.length
                ? { topicId: { in: effectiveTopicIds } }
                : {}),
              ...(resolvedMinTopicScore != null
                ? { finalScore: { gte: resolvedMinTopicScore } }
                : {}),
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
      ...includeTopicScoreRelation,
      ...includeEntityRelation,
      ...includeFeedbackRelation,
    },
  });

  const hasMore = contents.length > limit;
  const nextCursor = hasMore ? contents[limit].id : null;
  const pageItems = hasMore ? contents.slice(0, limit) : contents;
  const sortedItems =
    (sort === "topicScore" || sort === "relevance") && effectiveTopicIds.length > 0
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
