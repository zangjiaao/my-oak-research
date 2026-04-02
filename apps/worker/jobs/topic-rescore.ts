import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { createTopicRescoreWorker } from "@/lib/queue";
import type { TopicTermType } from "@/app/generated/prisma";

const prismaAny = prisma as any;

const RESCORE_BATCH_SIZE = Math.max(
  20,
  Math.min(500, Number(process.env.TOPIC_RESCORE_BATCH_SIZE ?? 100))
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
const RETRIEVAL_LOW_THRESHOLD = Number(process.env.RETRIEVAL_LOW_THRESHOLD ?? 0.5);

type TopicTermLite = {
  type: TopicTermType;
  value: string;
  weight: number;
};

type TopicWithTerms = {
  id: string;
  name: string;
  terms: TopicTermLite[];
};

function roundScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10000) / 10000;
}

function normalizeSparseScore(rawScore: number): number {
  if (!Number.isFinite(rawScore) || rawScore <= 0) {
    return 0;
  }
  return roundScore(Math.min(1, rawScore / 0.6));
}

function normalizeTermScore(score: number): number {
  if (!Number.isFinite(score) || score <= 0) {
    return 0;
  }
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

function buildTopicSparseQuery(topic: {
  name: string;
  terms: TopicTermLite[];
}): string {
  const terms = topic.terms
    .filter((term) => term.type !== "EXCLUSION")
    .map((term) => term.value.trim().toLowerCase())
    .filter(Boolean);
  const values = Array.from(new Set([topic.name.trim().toLowerCase(), ...terms])).filter(
    Boolean
  );
  return values.join(" ");
}

async function queryVectorSimilarityByBatch(
  contentIds: string[],
  topicId: string
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (contentIds.length === 0) {
    return result;
  }

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
  if (!topicQueryText.trim() || contentIds.length === 0) {
    return result;
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ contentId: string; score: number | null }>>(
    `WITH batch_ids AS (
       SELECT unnest($1::text[]) AS id
     )
     SELECT
       c.id AS "contentId",
       ts_rank_cd(
         setweight(to_tsvector('simple', coalesce(c.title, '')), 'A') ||
         setweight(to_tsvector('simple', coalesce(c.summary, '')), 'B') ||
         setweight(to_tsvector('simple', coalesce(c.markdown, '')), 'C'),
         websearch_to_tsquery('simple', $2)
       )::float8 AS "score"
     FROM "Content" c
     JOIN batch_ids b ON b.id = c.id
     WHERE (
       setweight(to_tsvector('simple', coalesce(c.title, '')), 'A') ||
       setweight(to_tsvector('simple', coalesce(c.summary, '')), 'B') ||
       setweight(to_tsvector('simple', coalesce(c.markdown, '')), 'C')
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

export const topicRescoreWorker = createTopicRescoreWorker(async (job) => {
  const { topicId, trigger, requestedBy } = job.data;
  logger.info("topic-rescore started", { topicId, trigger, requestedBy });

  const topic = (await prismaAny.topic.findUnique({
    where: { id: topicId },
    include: {
      terms: true,
    },
  })) as TopicWithTerms | null;

  if (!topic) {
    logger.warn("topic-rescore skipped: topic not found", { topicId });
    return { ok: false, reason: "topic-not-found" };
  }

  const coreTerms = topic.terms.filter((term) => term.type === "CORE");
  const expansionTerms = topic.terms.filter((term) => term.type === "EXPANSION");
  const exclusionTerms = topic.terms.filter((term) => term.type === "EXCLUSION");
  const topicQueryText = buildTopicSparseQuery({
    name: topic.name,
    terms: topic.terms as TopicTermLite[],
  });

  let cursor: string | undefined;
  let scanned = 0;
  let upserted = 0;
  let deleted = 0;
  let failed = 0;

  while (true) {
    const batch = await prisma.content.findMany({
      select: {
        id: true,
        title: true,
        summary: true,
        markdown: true,
      },
      orderBy: { id: "asc" },
      take: RESCORE_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!batch.length) break;

    const contentIds = batch.map((item) => item.id);
    const vectorByContentId = await queryVectorSimilarityByBatch(contentIds, topic.id);
    const sparseByContentId = await querySparseScoreByBatch(contentIds, topicQueryText);

    const operations = [];
    for (const content of batch) {
      scanned += 1;
      const normalizedText = `${content.title}\n${content.summary}\n${content.markdown}`.toLowerCase();
      const vectorScore = vectorByContentId.get(content.id) ?? 0;
      const bm25Score = sparseByContentId.get(content.id) ?? 0;
      const fusionScore = roundScore(
        vectorScore * RETRIEVAL_FUSION_ALPHA +
          bm25Score * (1 - RETRIEVAL_FUSION_ALPHA)
      );
      const coreScore = countTermMatches(normalizedText, coreTerms as TopicTermLite[]);
      const expansionScore = countTermMatches(
        normalizedText,
        expansionTerms as TopicTermLite[]
      );
      const exclusionPenalty = countTermMatches(
        normalizedText,
        exclusionTerms as TopicTermLite[]
      );
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
      const finalScore = roundScore(
        Math.max(0, Math.min(1, fusionScore + coreBoost + expansionBoost - exclusionCost))
      );
      const reason = `vector:${vectorScore.toFixed(3)} core:${coreScore.toFixed(2)} expansion:${expansionScore.toFixed(2)} exclusion:${exclusionPenalty.toFixed(2)}`;
      const explain = {
        bm25Score,
        fusionScore,
        vectorScore,
        coreScore,
        expansionScore,
        exclusionPenalty,
        keywordScore,
        baseFinalScore: finalScore,
        llmRerankScore: null,
        llmRerankWeight: 0,
        llmRerankForcedAt: null,
      };

      if (finalScore < RETRIEVAL_LOW_THRESHOLD && exclusionPenalty > 0) {
        operations.push(
          prisma.contentTopicScore
            .deleteMany({
              where: {
                contentId: content.id,
                topicId: topic.id,
              },
            })
            .then((res) => {
              if (res.count > 0) deleted += res.count;
            })
        );
        continue;
      }

      operations.push(
        prisma.contentTopicScore
          .upsert({
            where: {
              contentId_topicId: {
                contentId: content.id,
                topicId: topic.id,
              },
            },
            create: {
              contentId: content.id,
              topicId: topic.id,
              vectorScore,
              keywordScore,
              exclusionPenalty,
              finalScore,
              reason,
              explain,
            },
            update: {
              vectorScore,
              keywordScore,
              exclusionPenalty,
              finalScore,
              reason,
              explain,
            },
          })
          .then(() => {
            upserted += 1;
          })
      );
    }

    const settled = await Promise.allSettled(operations);
    for (const item of settled) {
      if (item.status === "rejected") {
        failed += 1;
        logger.error("topic-rescore item failed", {
          topicId: topic.id,
          error: logger.normalizeError(item.reason),
        });
      }
    }

    cursor = batch[batch.length - 1]?.id;
  }

  logger.info("topic-rescore finished", {
    topicId,
    trigger,
    requestedBy,
    scanned,
    upserted,
    deleted,
    failed,
  });
  return {
    ok: failed === 0,
    topicId,
    scanned,
    upserted,
    deleted,
    failed,
  };
});
