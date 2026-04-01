import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { llmGateway } from "@oak/agents/llm-gateway";
import type {
  Prisma,
  Content,
  ContentTopicScore,
  ContentEntity,
  TopicTermType,
} from "@/app/generated/prisma";
import { buildRecordContentViews } from "@/lib/follow-content/record-content-view";

const prismaAny = prisma as any;
const DEFAULT_TOPIC_FILTER_MIN_SCORE = Math.max(
  0,
  Math.min(1, Number(process.env.TOPIC_FILTER_MIN_SCORE ?? 0.4))
);
const DYNAMIC_TOPIC_SCORING_ENABLED =
  process.env.DYNAMIC_TOPIC_SCORING_ENABLED !== "false";
const TOPIC_SCORE_CACHE_TTL_MINUTES = Math.max(
  1,
  Math.min(1440, Number(process.env.TOPIC_SCORE_CACHE_TTL_MINUTES ?? 60))
);
const DYNAMIC_TOPIC_SCORING_CANDIDATE_LIMIT = Math.max(
  20,
  Math.min(300, Number(process.env.DYNAMIC_TOPIC_SCORING_CANDIDATE_LIMIT ?? 120))
);
const RETRIEVAL_FUSION_ALPHA = Math.min(
  1,
  Math.max(0, Number(process.env.RETRIEVAL_FUSION_ALPHA ?? 0.65))
);
const RETRIEVAL_CORE_WEIGHT = Math.max(
  0,
  Number(process.env.RETRIEVAL_CORE_WEIGHT ?? 0.1)
);
const RETRIEVAL_EXPANSION_WEIGHT = Math.max(
  0,
  Number(process.env.RETRIEVAL_EXPANSION_WEIGHT ?? 0.05)
);
const RETRIEVAL_EXCLUSION_WEIGHT = Math.max(
  0,
  Number(process.env.RETRIEVAL_EXCLUSION_WEIGHT ?? 0.03)
);
const DYNAMIC_TOPIC_SCORING_LLM_ENABLED =
  process.env.DYNAMIC_TOPIC_SCORING_LLM_ENABLED !== "false";
const DYNAMIC_TOPIC_SCORING_LLM_TOP_N = Math.max(
  1,
  Math.min(20, Number(process.env.DYNAMIC_TOPIC_SCORING_LLM_TOP_N ?? 8))
);
const DYNAMIC_TOPIC_SCORING_LLM_WEIGHT = Math.max(
  0,
  Math.min(1, Number(process.env.DYNAMIC_TOPIC_SCORING_LLM_WEIGHT ?? 0.6))
);
const DYNAMIC_TOPIC_SCORING_LLM_MIN_BASE = Math.max(
  0,
  Math.min(1, Number(process.env.DYNAMIC_TOPIC_SCORING_LLM_MIN_BASE ?? 0.25))
);
const DYNAMIC_TOPIC_SCORING_LLM_MODEL =
  process.env.DYNAMIC_TOPIC_SCORING_LLM_MODEL ||
  process.env.LLM_DEFAULT_MODEL ||
  "gpt-5-mini";

const TopicDynamicRerankSchema = z.object({
  scores: z
    .array(
      z.object({
        contentId: z.string().min(1),
        score: z.number().min(0).max(1),
      })
    )
    .default([]),
});

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

type TopicTermLite = {
  type: TopicTermType;
  value: string;
  weight: number;
};

type TopicLite = {
  id: string;
  name: string;
  terms: TopicTermLite[];
};

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function roundScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10000) / 10000;
}

function normalizeSparseScore(rawScore: number): number {
  if (!Number.isFinite(rawScore) || rawScore <= 0) return 0;
  return roundScore(Math.min(1, rawScore / 0.6));
}

function normalizeTermScore(score: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  return roundScore(Math.min(1, score / 3));
}

function countTermMatches(contentText: string, terms: TopicTermLite[]): number {
  let score = 0;
  for (const term of terms) {
    const normalized = term.value.trim().toLowerCase();
    if (!normalized) continue;
    if (contentText.includes(normalized)) {
      score += term.weight ?? 1;
    }
  }
  return score;
}

function buildTopicSparseQuery(topic: TopicLite): string {
  const terms = topic.terms
    .filter((term) => term.type !== "EXCLUSION")
    .map((term) => term.value.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([topic.name.trim().toLowerCase(), ...terms]))
    .filter(Boolean)
    .join(" ");
}

async function queryVectorSimilarityByBatch(
  contentIds: string[],
  topicId: string
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!contentIds.length) return result;

  const rows = await prisma.$queryRawUnsafe<
    Array<{ contentId: string; similarity: number | null }>
  >(
    `WITH batch_ids AS (
       SELECT unnest($1::text[]) AS id
     )
     SELECT
       c.id AS "contentId",
       (1 - (c."vector" <=> t."vector"))::float8 AS "similarity"
     FROM "Content" c
     JOIN "Topic" t ON t."id" = $2
     JOIN batch_ids b ON b.id = c.id
     WHERE c."vector" IS NOT NULL
       AND t."vector" IS NOT NULL`,
    contentIds,
    topicId
  );

  for (const row of rows) {
    if (!row.contentId) continue;
    result.set(
      row.contentId,
      roundScore(Math.max(0, Math.min(1, Number(row.similarity ?? 0))))
    );
  }
  return result;
}

async function querySparseScoreByBatch(
  contentIds: string[],
  topicQueryText: string
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!contentIds.length || !topicQueryText.trim()) return result;

  const rows = await prisma.$queryRawUnsafe<Array<{ contentId: string; score: number | null }>>(
    `WITH batch_ids AS (
       SELECT unnest($1::text[]) AS id
     )
     SELECT
       c.id AS "contentId",
       ts_rank_cd(
         setweight(to_tsvector('simple', coalesce(c.title, '')), 'A') ||
         setweight(to_tsvector('simple', coalesce(c.summary, '')), 'B'),
         websearch_to_tsquery('simple', $2)
       )::float8 AS "score"
     FROM "Content" c
     JOIN batch_ids b ON b.id = c.id
     WHERE (
       setweight(to_tsvector('simple', coalesce(c.title, '')), 'A') ||
       setweight(to_tsvector('simple', coalesce(c.summary, '')), 'B')
     ) @@ websearch_to_tsquery('simple', $2)`,
    contentIds,
    topicQueryText
  );

  for (const row of rows) {
    if (!row.contentId) continue;
    result.set(row.contentId, normalizeSparseScore(Number(row.score ?? 0)));
  }
  return result;
}

function getExplainExpiresAt(score: ContentTopicScore): Date | null {
  const explain = asObject(score.explain);
  const expiresAtRaw = explain.expiresAt;
  if (typeof expiresAtRaw !== "string") return null;
  const parsed = new Date(expiresAtRaw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function isScoreFresh(score: ContentTopicScore, now: Date): boolean {
  const expiresAt = getExplainExpiresAt(score);
  if (!expiresAt) return false;
  return expiresAt.getTime() > now.getTime();
}

async function scoreTopicForContentBatch(
  topic: TopicLite,
  contents: Array<Pick<Content, "id" | "title" | "summary">>
) {
  const contentIds = contents.map((content) => content.id);
  const vectorByContentId = await queryVectorSimilarityByBatch(contentIds, topic.id);
  const sparseByContentId = await querySparseScoreByBatch(
    contentIds,
    buildTopicSparseQuery(topic)
  );
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + TOPIC_SCORE_CACHE_TTL_MINUTES * 60 * 1000
  );
  const coreTerms = topic.terms.filter((term) => term.type === "CORE");
  const expansionTerms = topic.terms.filter((term) => term.type === "EXPANSION");
  const exclusionTerms = topic.terms.filter((term) => term.type === "EXCLUSION");
  const scoreDrafts = contents.map((content) => {
    const normalizedText = `${content.title}\n${content.summary}`.toLowerCase();
    const vectorScore = vectorByContentId.get(content.id) ?? 0;
    const bm25Score = sparseByContentId.get(content.id) ?? 0;
    const fusionScore = roundScore(
      vectorScore * RETRIEVAL_FUSION_ALPHA + bm25Score * (1 - RETRIEVAL_FUSION_ALPHA)
    );
    const coreScore = countTermMatches(normalizedText, coreTerms);
    const expansionScore = countTermMatches(normalizedText, expansionTerms);
    const exclusionPenalty = countTermMatches(normalizedText, exclusionTerms);
    const keywordScore = roundScore(bm25Score * 10 + coreScore + expansionScore);
    const coreBoost = Math.max(
      0,
      Math.min(1, normalizeTermScore(coreScore) * RETRIEVAL_CORE_WEIGHT)
    );
    const expansionBoost = Math.max(
      0,
      Math.min(1, normalizeTermScore(expansionScore) * RETRIEVAL_EXPANSION_WEIGHT)
    );
    const exclusionCost = exclusionPenalty * RETRIEVAL_EXCLUSION_WEIGHT;
    const baseFinalScore = roundScore(
      Math.max(0, Math.min(1, fusionScore + coreBoost + expansionBoost - exclusionCost))
    );
    return {
      contentId: content.id,
      title: content.title,
      summary: content.summary,
      vectorScore,
      bm25Score,
      fusionScore,
      coreScore,
      expansionScore,
      exclusionPenalty,
      keywordScore,
      baseFinalScore,
    };
  });

  const llmRerankByContentId = new Map<string, number>();
  if (DYNAMIC_TOPIC_SCORING_LLM_ENABLED && DYNAMIC_TOPIC_SCORING_LLM_WEIGHT > 0) {
    const llmCandidates = scoreDrafts
      .filter((draft) => draft.baseFinalScore >= DYNAMIC_TOPIC_SCORING_LLM_MIN_BASE)
      .sort((left, right) => right.baseFinalScore - left.baseFinalScore)
      .slice(0, DYNAMIC_TOPIC_SCORING_LLM_TOP_N);
    if (llmCandidates.length > 0) {
      try {
        const payload = await llmGateway.json("topic-dynamic-rerank", {
          model: DYNAMIC_TOPIC_SCORING_LLM_MODEL,
          temperature: 0,
          metadata: {
            topicId: topic.id,
            mode: "memory-first-dynamic-rerank",
          },
          prompt: [
            "你是主题内容相关度评估助手。",
            "请基于 topic 与 content 的 title+summary 评估相关度，返回 0~1 分数。",
            "仅返回 JSON：{\"scores\":[{\"contentId\":\"...\",\"score\":0.0}]}",
            "",
            `topicId=${topic.id}`,
            `topicName=${topic.name}`,
            `coreTerms=${coreTerms.map((term) => term.value).join(",") || "-"}`,
            `expansionTerms=${expansionTerms.map((term) => term.value).join(",") || "-"}`,
            "",
            ...llmCandidates.map(
              (candidate) =>
                `contentId=${candidate.contentId}\ntitle=${candidate.title}\nsummary=${candidate.summary.slice(0, 600)}`
            ),
          ].join("\n"),
        });
        const checked = TopicDynamicRerankSchema.safeParse(payload);
        if (checked.success) {
          for (const item of checked.data.scores) {
            llmRerankByContentId.set(item.contentId, roundScore(item.score));
          }
        }
      } catch {
        // Dynamic rerank failure should not block base scoring.
      }
    }
  }

  const upserted = await Promise.all(
    scoreDrafts.map(async (draft) => {
      const llmScore = llmRerankByContentId.get(draft.contentId);
      const finalScore =
        typeof llmScore === "number"
          ? roundScore(
              Math.max(
                0,
                Math.min(
                  1,
                  draft.baseFinalScore * (1 - DYNAMIC_TOPIC_SCORING_LLM_WEIGHT) +
                    llmScore * DYNAMIC_TOPIC_SCORING_LLM_WEIGHT
                )
              )
            )
          : draft.baseFinalScore;
      const reasonCore = `vector:${draft.vectorScore.toFixed(3)} core:${draft.coreScore.toFixed(
        2
      )} expansion:${draft.expansionScore.toFixed(2)} exclusion:${draft.exclusionPenalty.toFixed(2)}`;
      const reason =
        typeof llmScore === "number" ? `${reasonCore} llm:${llmScore.toFixed(3)}` : reasonCore;

      const score = await prisma.contentTopicScore.upsert({
        where: {
          contentId_topicId: {
            contentId: draft.contentId,
            topicId: topic.id,
          },
        },
        create: {
          contentId: draft.contentId,
          topicId: topic.id,
          vectorScore: draft.vectorScore,
          keywordScore: draft.keywordScore,
          exclusionPenalty: draft.exclusionPenalty,
          finalScore,
          reason,
          explain: {
            bm25Score: draft.bm25Score,
            fusionScore: draft.fusionScore,
            vectorScore: draft.vectorScore,
            coreScore: draft.coreScore,
            expansionScore: draft.expansionScore,
            exclusionPenalty: draft.exclusionPenalty,
            keywordScore: draft.keywordScore,
            baseFinalScore: draft.baseFinalScore,
            llmRerankScore: llmScore ?? null,
            llmRerankWeight:
              typeof llmScore === "number" ? DYNAMIC_TOPIC_SCORING_LLM_WEIGHT : 0,
            scoreMode: "memory-first",
            scoredAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
          } as Prisma.InputJsonValue,
        },
        update: {
          vectorScore: draft.vectorScore,
          keywordScore: draft.keywordScore,
          exclusionPenalty: draft.exclusionPenalty,
          finalScore,
          reason,
          explain: {
            bm25Score: draft.bm25Score,
            fusionScore: draft.fusionScore,
            vectorScore: draft.vectorScore,
            coreScore: draft.coreScore,
            expansionScore: draft.expansionScore,
            exclusionPenalty: draft.exclusionPenalty,
            keywordScore: draft.keywordScore,
            baseFinalScore: draft.baseFinalScore,
            llmRerankScore: llmScore ?? null,
            llmRerankWeight:
              typeof llmScore === "number" ? DYNAMIC_TOPIC_SCORING_LLM_WEIGHT : 0,
            scoreMode: "memory-first",
            scoredAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
      return score;
    })
  );

  return upserted;
}

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
  const views = buildRecordContentViews(item);
  const meta = asObject(item.meta);
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
        const expiresAtRaw =
          typeof explain.expiresAt === "string" ? explain.expiresAt : null;
        const scoreMode =
          typeof explain.scoreMode === "string" ? explain.scoreMode : null;
        const llmReranked =
          typeof llmRerankScoreRaw === "number" &&
          Number.isFinite(llmRerankScoreRaw);
        const llmRerankKeywords = llmRerankKeywordsRaw
          .map((entry) =>
            entry && typeof entry === "object" && !Array.isArray(entry)
              ? (entry as Record<string, unknown>)
              : null
          )
          .filter(Boolean)
          .map((entry) => ({
            category: String(entry!.category ?? "").trim(),
            label: String(entry!.label ?? "").trim(),
          }))
          .filter(
            (entry) =>
              [
                "PERSON",
                "ORG",
                "LOCATION",
                "TECH",
                "PRODUCT",
                "EVENT",
                "CONCEPT",
              ].includes(entry.category) &&
              entry.label.length >= 2 &&
              entry.label.length <= 40
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
          expiresAt: expiresAtRaw,
          scoreMode,
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
  const userId =
    request.headers.get("x-user-id")?.trim() ||
    process.env.DEFAULT_USER_ID ||
    "default-user-id";
  const dynamicMode =
    DYNAMIC_TOPIC_SCORING_ENABLED && effectiveTopicIds.length > 0;

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

  if (!dynamicMode && (effectiveTopicIds.length || resolvedMinTopicScore != null)) {
    where.topicScores = {
      some: {
        ...(effectiveTopicIds.length ? { topicId: { in: effectiveTopicIds } } : {}),
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
            },
            orderBy: { finalScore: "desc" as const },
          },
        }
      : { topicScores: { take: 0 } };
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

  const take = dynamicMode
    ? Math.max(limit + 1, DYNAMIC_TOPIC_SCORING_CANDIDATE_LIMIT)
    : limit + 1;

  const contents = await prismaAny.content.findMany({
    where,
    orderBy: { time: "desc" },
    take,
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
    include: {
      ...includeTopicScoreRelation,
      ...includeEntityRelation,
      ...includeFeedbackRelation,
    },
  });

  let processedItems = contents as Array<
    Content & {
      image?: string | null;
      topicScores?: ContentTopicScore[];
      entities?: ContentEntity | null;
      topicFeedbacks?: Array<{
        vote: "UP" | "DOWN" | "NONE";
        note: string | null;
        topicId: string;
      }>;
    }
  >;

  if (dynamicMode && processedItems.length > 0) {
    const topics = (await prisma.topic.findMany({
      where: { id: { in: effectiveTopicIds } },
      include: { terms: true },
    })) as unknown as TopicLite[];
    const topicById = new Map(topics.map((entry) => [entry.id, entry]));
    const now = new Date();

    for (const topicKey of effectiveTopicIds) {
      const topic = topicById.get(topicKey);
      if (!topic) continue;
      const staleContents = processedItems
        .filter((content) => {
          const existing = (content.topicScores ?? []).find(
            (score) => score.topicId === topic.id
          );
          if (!existing) return true;
          if (existing.finalScore == null) return true;
          return !isScoreFresh(existing, now);
        })
        .map((content) => ({
          id: content.id,
          title: content.title,
          summary: content.summary,
        }));

      if (staleContents.length > 0) {
        const rescored = await scoreTopicForContentBatch(topic, staleContents);
        const rescoredByContentId = new Map(
          rescored.map((entry) => [entry.contentId, entry])
        );
        processedItems = processedItems.map((content) => {
          const replaced = rescoredByContentId.get(content.id);
          if (!replaced) return content;
          const remained = (content.topicScores ?? []).filter(
            (score) => score.topicId !== topic.id
          );
          return {
            ...content,
            topicScores: [...remained, replaced].sort(
              (left, right) => (right.finalScore ?? -1) - (left.finalScore ?? -1)
            ),
          };
        });
      }
    }
  }

  let filteredItems = processedItems;
  if (resolvedMinTopicScore != null && effectiveTopicIds.length > 0) {
    filteredItems = processedItems.filter((item) =>
      (item.topicScores ?? []).some(
        (score) =>
          effectiveTopicIds.includes(score.topicId) &&
          (score.finalScore ?? -1) >= resolvedMinTopicScore
      )
    );
  }

  const sortedItems =
    (sort === "topicScore" || sort === "relevance") && effectiveTopicIds.length > 0
      ? [...filteredItems].sort((left, right) => {
          const leftScore = Math.max(
            ...(left.topicScores ?? [])
              .filter((score) => effectiveTopicIds.includes(score.topicId))
              .map((score) => score.finalScore ?? -1),
            -1
          );
          const rightScore = Math.max(
            ...(right.topicScores ?? [])
              .filter((score) => effectiveTopicIds.includes(score.topicId))
              .map((score) => score.finalScore ?? -1),
            -1
          );
          return rightScore - leftScore;
        })
      : filteredItems;

  const hasMore = sortedItems.length > limit;
  const nextCursor = hasMore ? sortedItems[limit].id : null;
  const pageItems = hasMore ? sortedItems.slice(0, limit) : sortedItems;
  const items = pageItems.map((item) => mapContent(item));

  const response: ContentResponse = {
    items,
    nextCursor,
  };

  return NextResponse.json(response);
}
