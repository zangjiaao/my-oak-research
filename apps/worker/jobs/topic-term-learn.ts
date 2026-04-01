import prisma from "@/lib/prisma";
import { llmGateway } from "@oak/agents/llm-gateway";
import { logger } from "@/lib/logger";
import { createTopicTermLearnWorker, scheduleTopicRescore } from "@/lib/queue";
import { refreshTopicVector } from "@/lib/topic-vector";
import { z } from "zod";

const prismaAny = prisma as any;

const TOPIC_TERM_LEARN_MAX_FEEDBACKS = Math.max(
  3,
  Math.min(50, Number(process.env.TOPIC_TERM_LEARN_MAX_FEEDBACKS ?? 20))
);
const TOPIC_TERM_LEARN_MODEL =
  process.env.TOPIC_TERM_LEARN_MODEL ||
  process.env.LLM_DEFAULT_MODEL ||
  "gpt-5-mini";
const TOPIC_TERM_LEARN_CORE_MAX = Math.max(
  1,
  Math.min(8, Number(process.env.TOPIC_TERM_LEARN_CORE_MAX ?? 4))
);
const TOPIC_TERM_LEARN_EXPANSION_MAX = Math.max(
  1,
  Math.min(12, Number(process.env.TOPIC_TERM_LEARN_EXPANSION_MAX ?? 6))
);
const TOPIC_TERM_LEARN_MIN_CONFIDENCE = Math.max(
  0,
  Math.min(1, Number(process.env.TOPIC_TERM_LEARN_MIN_CONFIDENCE ?? 0.7))
);

const TopicTermLearnSchema = z.object({
  terms: z
    .array(
      z.object({
        type: z.enum(["CORE", "EXPANSION"]),
        value: z.string().min(2).max(64),
        weight: z.number().min(0.1).max(3).optional(),
        confidence: z.number().min(0).max(1).optional(),
      })
    )
    .max(24)
    .default([]),
});

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeTermValue(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.length < 2 || normalized.length > 64) return null;
  if (!/[\p{L}\p{Script=Han}\p{N}]/u.test(normalized)) return null;
  if (/[:：|/]/.test(normalized)) return null;
  return normalized;
}

export const topicTermLearnWorker = createTopicTermLearnWorker(async (job) => {
  const { topicId, trigger, requestedBy } = job.data;
  logger.info("topic-term-learn started", { topicId, trigger, requestedBy });

  const topic = await prismaAny.topic.findUnique({
    where: { id: topicId },
    include: {
      terms: true,
    },
  });
  if (!topic) {
    logger.warn("topic-term-learn skipped: topic not found", { topicId });
    return { ok: false, reason: "topic-not-found" };
  }

  const positives = await prismaAny.contentTopicFeedback.findMany({
    where: {
      topicId,
      vote: "UP",
    },
    orderBy: { updatedAt: "desc" },
    take: TOPIC_TERM_LEARN_MAX_FEEDBACKS,
    include: {
      content: {
        select: {
          id: true,
          title: true,
          summary: true,
          meta: true,
        },
      },
    },
  });
  if (!positives.length) {
    logger.info("topic-term-learn skipped: no positive feedback", { topicId });
    return { ok: true, inserted: 0, reason: "no-positive-feedback" };
  }

  const examples = positives
    .map((entry: any) => {
      const meta = asObject(entry.content?.meta);
      const aiSummary =
        typeof meta.aiSummary === "string" ? meta.aiSummary.trim() : "";
      const summary =
        aiSummary || (entry.content?.summary ? String(entry.content.summary).trim() : "");
      const title = entry.content?.title ? String(entry.content.title).trim() : "";
      if (!title && !summary) return null;
      return {
        contentId: String(entry.content?.id ?? ""),
        title,
        summary: summary.slice(0, 500),
      };
    })
    .filter(Boolean) as Array<{ contentId: string; title: string; summary: string }>;
  if (!examples.length) {
    logger.info("topic-term-learn skipped: no usable feedback examples", { topicId });
    return { ok: true, inserted: 0, reason: "no-usable-examples" };
  }

  let llmPayload: unknown;
  try {
    llmPayload = await llmGateway.json("topic-term-learn-from-feedback", {
      model: TOPIC_TERM_LEARN_MODEL,
      temperature: 0.1,
      metadata: {
        topicId,
        trigger,
        feedbackCount: examples.length,
      },
      prompt: [
        "你是主题检索词提炼助手。",
        "请根据 topic 与用户点赞内容（title+summary）提炼少量高精度词。",
        "要求：",
        "1) 仅输出 CORE 和 EXPANSION；",
        `2) CORE 最多 ${TOPIC_TERM_LEARN_CORE_MAX} 个，EXPANSION 最多 ${TOPIC_TERM_LEARN_EXPANSION_MAX} 个；`,
        "3) 优先实体词：人物、组织、地点、产品、技术名词；",
        "4) 禁止口语碎片、停用词、时间词、无意义短语；",
        "5) 每项给 confidence (0~1)；低于0.7不要输出。",
        '只返回 JSON: {"terms":[{"type":"CORE","value":"...","weight":1.2,"confidence":0.86}]}',
        "",
        `Topic Name: ${topic.name}`,
        topic.description ? `Topic Description: ${topic.description}` : "",
        "",
        ...examples.map(
          (item, index) =>
            `Example ${index + 1}\ncontentId=${item.contentId}\ntitle=${item.title}\nsummary=${item.summary}`
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    });
  } catch (error) {
    logger.warn("topic-term-learn llm failed", {
      topicId,
      error: logger.normalizeError(error),
    });
    return { ok: false, reason: "llm-request-failed" };
  }

  const checked = TopicTermLearnSchema.safeParse(llmPayload);
  if (!checked.success) {
    logger.warn("topic-term-learn invalid payload", {
      topicId,
      details: checked.error.flatten(),
    });
    return { ok: false, reason: "invalid-llm-payload" };
  }

  const existing = new Set(
    (topic.terms ?? []).map(
      (term: any) => `${String(term.type).toUpperCase()}:${String(term.value).toLowerCase()}`
    )
  );
  const selectedByType = {
    CORE: 0,
    EXPANSION: 0,
  };
  const nextTerms: Array<{
    type: "CORE" | "EXPANSION";
    value: string;
    weight: number;
    confidence: number;
  }> = [];

  for (const term of checked.data.terms.sort(
    (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)
  )) {
    const confidence = term.confidence ?? 0;
    if (confidence < TOPIC_TERM_LEARN_MIN_CONFIDENCE) continue;
    const normalizedValue = normalizeTermValue(term.value);
    if (!normalizedValue) continue;
    const key = `${term.type}:${normalizedValue}`;
    if (existing.has(key)) continue;
    if (nextTerms.some((item) => `${item.type}:${item.value}` === key)) continue;
    if (
      term.type === "CORE" &&
      selectedByType.CORE >= TOPIC_TERM_LEARN_CORE_MAX
    ) {
      continue;
    }
    if (
      term.type === "EXPANSION" &&
      selectedByType.EXPANSION >= TOPIC_TERM_LEARN_EXPANSION_MAX
    ) {
      continue;
    }
    selectedByType[term.type] += 1;
    nextTerms.push({
      type: term.type,
      value: normalizedValue,
      weight: term.weight ?? (term.type === "CORE" ? 1.2 : 1),
      confidence,
    });
  }

  if (!nextTerms.length) {
    logger.info("topic-term-learn no new terms", { topicId });
    return { ok: true, inserted: 0, reason: "no-new-terms" };
  }

  await prismaAny.topicTerm.createMany({
    data: nextTerms.map((term) => ({
      topicId,
      type: term.type,
      value: term.value,
      weight: term.weight,
      meta: {
        source: "feedback-learn",
        trigger,
        confidence: term.confidence,
      },
    })),
    skipDuplicates: true,
  });

  try {
    await refreshTopicVector(prismaAny, topicId);
  } catch (error) {
    logger.warn("topic-term-learn vector refresh failed", {
      topicId,
      error: logger.normalizeError(error),
    });
  }

  try {
    await scheduleTopicRescore({
      topicId,
      trigger: "topic-term-add",
      requestedBy,
    });
  } catch (error) {
    logger.warn("topic-term-learn rescore schedule failed", {
      topicId,
      error: logger.normalizeError(error),
    });
  }

  logger.info("topic-term-learn finished", {
    topicId,
    inserted: nextTerms.length,
    feedbackCount: positives.length,
  });
  return { ok: true, inserted: nextTerms.length };
});
