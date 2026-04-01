import { z } from "zod";
import { llmGateway } from "@oak/agents/llm-gateway";
import { logger } from "@/lib/logger";
import { refreshTopicVector } from "@/lib/topic-vector";
import { scheduleTopicRescore } from "@/lib/queue";

const AUTO_TOPIC_TERMS_ENABLED =
  process.env.TOPIC_TERMS_AUTO_REFRESH_ENABLED !== "false";
const AUTO_TOPIC_TERMS_MODEL =
  process.env.TOPIC_TERMS_REFRESH_MODEL ||
  process.env.LLM_DEFAULT_MODEL ||
  "gpt-5-mini";

const TopicTermsRefreshSchema = z.object({
  terms: z
    .array(
      z.object({
        type: z.enum(["CORE", "EXPANSION", "EXCLUSION"]),
        value: z.string().min(1).max(64),
        weight: z.number().min(0.1).max(3).optional(),
      })
    )
    .max(36)
    .default([]),
});

type TopicTermRefreshResult = {
  autoTermsUpdated: boolean;
  autoTermsCount: number;
  rescoreScheduled: boolean;
  rescoreJobId: string | null;
  vectorRefreshed: boolean;
  autoTermsReason: string | null;
};

function normalizeTermValue(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.length < 2 || normalized.length > 64) return null;
  if (!/[\p{L}\p{Script=Han}\p{N}]/u.test(normalized)) return null;
  return normalized;
}

export async function refreshTopicTermsAuto(params: {
  prismaAny: any;
  topicId: string;
  trigger: "topic-create" | "topic-update";
}): Promise<TopicTermRefreshResult> {
  const { prismaAny, topicId, trigger } = params;
  if (!AUTO_TOPIC_TERMS_ENABLED) {
    return {
      autoTermsUpdated: false,
      autoTermsCount: 0,
      rescoreScheduled: false,
      rescoreJobId: null,
      vectorRefreshed: false,
      autoTermsReason: "disabled",
    };
  }

  const topic = await prismaAny.topic.findUnique({
    where: { id: topicId },
    select: {
      id: true,
      name: true,
      description: true,
      terms: {
        select: {
          type: true,
          value: true,
          weight: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 24,
      },
    },
  });
  if (!topic) {
    return {
      autoTermsUpdated: false,
      autoTermsCount: 0,
      rescoreScheduled: false,
      rescoreJobId: null,
      vectorRefreshed: false,
      autoTermsReason: "topic-not-found",
    };
  }

  let llmPayload: unknown;
  try {
    llmPayload = await llmGateway.json("topic-terms-refresh", {
      model: AUTO_TOPIC_TERMS_MODEL,
      temperature: 0.2,
      metadata: {
        topicId,
        trigger,
      },
      prompt: [
        "你是主题检索词生成器。",
        "请根据 topic 名称与描述，输出用于内容检索的三类词：CORE、EXPANSION、EXCLUSION。",
        "规则：",
        "1) CORE: 最核心语义锚点，建议 4-8 个；",
        "2) EXPANSION: 同义词、英文表达、上下位词、常见实体，建议 6-16 个；",
        "3) EXCLUSION: 易混淆但不相关项，建议 0-8 个；",
        "4) value 2-64 字，不重复，不带解释；",
        "5) weight 0.1-3，默认 1。",
        '只输出 JSON: {"terms":[{"type":"CORE","value":"...","weight":1}]}',
        "",
        `Topic Name: ${topic.name}`,
        topic.description ? `Topic Description: ${topic.description}` : "",
        topic.terms.length
          ? `Existing Terms: ${topic.terms
              .map((term: any) => `${term.type}:${term.value}`)
              .join(", ")}`
          : "Existing Terms: (none)",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  } catch (error) {
    logger.warn("auto topic terms refresh failed", {
      topicId,
      trigger,
      error: logger.normalizeError(error),
    });
    return {
      autoTermsUpdated: false,
      autoTermsCount: 0,
      rescoreScheduled: false,
      rescoreJobId: null,
      vectorRefreshed: false,
      autoTermsReason: "llm-request-failed",
    };
  }

  const parsed = TopicTermsRefreshSchema.safeParse(llmPayload);
  if (!parsed.success) {
    logger.warn("auto topic terms refresh invalid payload", {
      topicId,
      trigger,
      details: parsed.error.flatten(),
    });
    return {
      autoTermsUpdated: false,
      autoTermsCount: 0,
      rescoreScheduled: false,
      rescoreJobId: null,
      vectorRefreshed: false,
      autoTermsReason: "invalid-llm-payload",
    };
  }

  const terms = Array.from(
    new Map(
      parsed.data.terms
        .map((term) => {
          const value = normalizeTermValue(term.value);
          if (!value) return null;
          return {
            type: term.type,
            value,
            weight: term.weight ?? 1,
          };
        })
        .filter(Boolean)
        .map((term) => [`${term!.type}:${term!.value}`, term!])
    ).values()
  );
  if (!terms.length) {
    return {
      autoTermsUpdated: false,
      autoTermsCount: 0,
      rescoreScheduled: false,
      rescoreJobId: null,
      vectorRefreshed: false,
      autoTermsReason: "empty-terms",
    };
  }

  await prismaAny.$transaction(async (tx: any) => {
    await tx.topicTerm.deleteMany({
      where: { topicId },
    });
    await tx.topicTerm.createMany({
      data: terms.map((term) => ({
        topicId,
        type: term.type,
        value: term.value,
        weight: term.weight,
        meta: { source: "auto-llm", trigger },
      })),
      skipDuplicates: true,
    });
  });

  let vectorRefreshed = false;
  try {
    await refreshTopicVector(prismaAny, topicId);
    vectorRefreshed = true;
  } catch (error) {
    logger.warn("topic vector refresh failed after auto terms", {
      topicId,
      error: logger.normalizeError(error),
    });
  }

  let rescoreScheduled = false;
  let rescoreJobId: string | null = null;
  try {
    const scheduled = await scheduleTopicRescore({
      topicId,
      trigger: "topic-update",
    });
    rescoreScheduled = scheduled.scheduled;
    rescoreJobId = scheduled.jobId;
  } catch (error) {
    logger.warn("topic rescore schedule failed after auto terms", {
      topicId,
      error: logger.normalizeError(error),
    });
  }

  return {
    autoTermsUpdated: true,
    autoTermsCount: terms.length,
    vectorRefreshed,
    rescoreScheduled,
    rescoreJobId,
    autoTermsReason: null,
  };
}
