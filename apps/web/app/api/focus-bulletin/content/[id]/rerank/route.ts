import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { llmGateway } from "@oak/agents/llm-gateway";
import { logger } from "@/lib/logger";
import type { Prisma, TopicTermType } from "@/app/generated/prisma";

const RerankSchema = z.object({
  topicId: z.string().cuid(),
});

const RerankResultSchema = z.object({
  score: z.number().min(0).max(1),
});

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asStringList(values: string[]): string {
  return values.filter(Boolean).join(", ");
}

function roundScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1000) / 1000;
}

function collectTerms(
  terms: Array<{ type: TopicTermType; value: string }>,
  type: TopicTermType
) {
  return terms
    .filter((term) => term.type === type)
    .map((term) => term.value.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export async function POST(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  const contentId = params.id;
  if (!contentId) {
    return NextResponse.json({ error: "contentId is required" }, { status: 400 });
  }

  const payload = await request.json().catch(() => ({}));
  const parsed = RerankSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const topicId = parsed.data.topicId;

  const [content, topic, scoreRecord] = await Promise.all([
    prisma.content.findUnique({
      where: { id: contentId },
      select: {
        id: true,
        title: true,
        summary: true,
        markdown: true,
        platform: true,
        time: true,
      },
    }),
    prisma.topic.findUnique({
      where: { id: topicId },
      select: {
        id: true,
        name: true,
        description: true,
        terms: {
          select: {
            type: true,
            value: true,
          },
          orderBy: { weight: "desc" },
        },
      },
    }),
    prisma.contentTopicScore.findUnique({
      where: {
        contentId_topicId: {
          contentId,
          topicId,
        },
      },
      select: {
        id: true,
        finalScore: true,
        reason: true,
        explain: true,
      },
    }),
  ]);

  if (!content) {
    return NextResponse.json({ error: "Content not found" }, { status: 404 });
  }
  if (!topic) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }
  if (!scoreRecord) {
    return NextResponse.json(
      { error: "Topic score not found for this content" },
      { status: 404 }
    );
  }

  const coreTerms = collectTerms(topic.terms, "CORE");
  const expansionTerms = collectTerms(topic.terms, "EXPANSION");
  const exclusionTerms = collectTerms(topic.terms, "EXCLUSION");
  const contentText = [content.title, content.summary, content.markdown]
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 5000);
  if (!contentText) {
    return NextResponse.json({ error: "No content text to rerank" }, { status: 400 });
  }

  const model = process.env.LLM_DEFAULT_MODEL ?? "gpt-5-mini";
  let llmPayload: unknown;
  try {
    llmPayload = await llmGateway.json("topic-rerank-force", {
      model,
      temperature: 0,
      metadata: {
        contentId,
        topicId,
        mode: "manual-force-rerank",
      },
      prompt: [
        "你是内容与主题匹配度评估助手。",
        "请根据主题定义判断该内容与主题的匹配度，返回 0~1 分数。",
        "0=完全无关，0.5=部分相关，1=高度相关。",
        '只返回 JSON：{"score":0.0}',
        "",
        `Topic: ${topic.name}`,
        topic.description ? `Topic Description: ${topic.description}` : null,
        `CORE terms: ${asStringList(coreTerms) || "-"}`,
        `EXPANSION terms: ${asStringList(expansionTerms) || "-"}`,
        `EXCLUSION terms: ${asStringList(exclusionTerms) || "-"}`,
        "",
        `Content platform: ${content.platform}`,
        `Content time: ${content.time.toISOString()}`,
        "Content:",
        contentText,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  } catch (error) {
    logger.error("failed to force rerank content topic score", {
      contentId,
      topicId,
      model,
      error: logger.normalizeError(error),
    });
    return NextResponse.json({ error: "LLM rerank failed" }, { status: 502 });
  }

  const checked = RerankResultSchema.safeParse(llmPayload);
  if (!checked.success) {
    logger.error("invalid rerank score payload", {
      contentId,
      topicId,
      model,
      details: checked.error.flatten(),
    });
    return NextResponse.json({ error: "Invalid rerank result" }, { status: 502 });
  }

  const llmRerankScore = roundScore(checked.data.score);
  const rerankWeight = Math.max(
    0,
    Math.min(0.5, Number(process.env.RETRIEVAL_LLM_RERANK_WEIGHT ?? 0.2))
  );
  const explain = asObject(scoreRecord.explain);
  const baseFinalScore =
    typeof explain.baseFinalScore === "number"
      ? roundScore(explain.baseFinalScore)
      : roundScore(scoreRecord.finalScore ?? 0);
  const finalScore = roundScore(
    Math.max(
      0,
      Math.min(
        1,
        baseFinalScore * (1 - rerankWeight) + llmRerankScore * rerankWeight
      )
    )
  );

  const now = new Date().toISOString();
  const updatedExplain = {
    ...explain,
    baseFinalScore,
    llmRerankScore,
    llmRerankWeight: rerankWeight,
    llmRerankForcedAt: now,
  };
  const reasonPrefix =
    typeof scoreRecord.reason === "string" && scoreRecord.reason.trim()
      ? scoreRecord.reason
      : `manual-rerank topic:${topic.name}`;
  const reason = `${reasonPrefix} llm:${llmRerankScore.toFixed(3)}`;

  await prisma.contentTopicScore.update({
    where: { id: scoreRecord.id },
    data: {
      finalScore,
      reason,
      explain: updatedExplain as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({
    success: true,
    data: {
      contentId,
      topicId,
      finalScore,
      llmReranked: true,
      llmRerankScore,
      baseFinalScore,
      llmRerankWeight: rerankWeight,
      llmRerankForcedAt: now,
    },
  });
}

