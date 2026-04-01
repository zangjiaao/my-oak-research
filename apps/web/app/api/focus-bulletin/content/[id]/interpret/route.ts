import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { llmGateway } from "@oak/agents/llm-gateway";
import { logger } from "@/lib/logger";
import { resolveActiveContentState } from "@/lib/follow-content/active-content-state";
import type { Prisma } from "@/app/generated/prisma";

const RequestSchema = z.object({
  topicId: z.string().cuid(),
  force: z.boolean().optional().default(false),
});

const InterpretationSchema = z.object({
  analysis: z.string().min(40).max(1200),
  keyPoints: z.array(z.string().min(2).max(120)).min(1).max(8),
});

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

  const body = await request.json().catch(() => ({}));
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { topicId, force } = parsed.data;
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
        url: true,
        meta: true,
      },
    }),
    prisma.topic.findUnique({
      where: { id: topicId },
      select: {
        id: true,
        name: true,
        description: true,
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

  const explain = asObject(scoreRecord.explain);
  const existingInterpretation =
    explain.aiInterpretation &&
    typeof explain.aiInterpretation === "object" &&
    !Array.isArray(explain.aiInterpretation)
      ? (explain.aiInterpretation as Record<string, unknown>)
      : null;
  if (existingInterpretation && !force) {
    const analysis = asString(existingInterpretation.analysis);
    if (analysis) {
      const keyPoints = Array.isArray(existingInterpretation.keyPoints)
        ? existingInterpretation.keyPoints
            .filter((item) => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
        : [];
      return NextResponse.json({
        success: true,
        data: {
          contentId,
          topicId,
          interpretation: {
            analysis,
            keyPoints,
            updatedAt:
              typeof existingInterpretation.updatedAt === "string"
                ? existingInterpretation.updatedAt
                : null,
            model:
              typeof existingInterpretation.model === "string"
                ? existingInterpretation.model
                : null,
          },
          reused: true,
        },
      });
    }
  }

  const activeState = resolveActiveContentState({
    title: content.title,
    summary: content.summary,
    markdown: content.markdown,
    meta: content.meta,
  });
  const contentText = activeState.activeText.slice(0, 9000);
  if (!contentText) {
    return NextResponse.json(
      { error: "No content text for interpretation" },
      { status: 400 }
    );
  }

  const model = process.env.LLM_DEFAULT_MODEL ?? "gpt-5-mini";
  let llmOutput: unknown;
  try {
    llmOutput = await llmGateway.json("topic-content-interpret", {
      model,
      temperature: 0.2,
      metadata: {
        mode: "manual-topic-interpret",
        contentId,
        topicId,
      },
      prompt: [
        "你是情报分析助手。",
        "请根据 Topic 对当前内容进行解读，聚焦“与Topic相关”的信息，不要扩写无关内容。",
        "输出要求：",
        "1) analysis: 120~500字，结构化阐述与Topic相关的核心观点；",
        "2) keyPoints: 3~8条，每条一句话，聚焦证据点/关联点；",
        "3) 不编造事实，不输出与主题无关的泛化结论。",
        "",
        `Topic: ${topic.name}`,
        topic.description ? `Topic Description: ${topic.description}` : null,
        "",
        `Content title: ${activeState.activeTitle}`,
        activeState.activeSummaryHint
          ? `Content summary hint: ${activeState.activeSummaryHint}`
          : null,
        content.url ? `Content url: ${content.url}` : null,
        `Content platform: ${content.platform}`,
        `Content time: ${content.time.toISOString()}`,
        "",
        "Content:",
        contentText,
        "",
        '只返回 JSON: {"analysis":"...","keyPoints":["..."]}',
      ]
        .filter(Boolean)
        .join("\n"),
    });
  } catch (error) {
    logger.error("failed to generate topic interpretation", {
      contentId,
      topicId,
      model,
      error: logger.normalizeError(error),
    });
    return NextResponse.json({ error: "AI interpretation generation failed" }, { status: 502 });
  }

  const checked = InterpretationSchema.safeParse(llmOutput);
  if (!checked.success) {
    logger.error("invalid topic interpretation output", {
      contentId,
      topicId,
      model,
      details: checked.error.flatten(),
    });
    return NextResponse.json({ error: "Invalid AI interpretation result" }, { status: 502 });
  }

  const now = new Date().toISOString();
  const interpretation = {
    analysis: checked.data.analysis.trim(),
    keyPoints: checked.data.keyPoints.map((item) => item.trim()).filter(Boolean),
    updatedAt: now,
    model,
  };
  const nextExplain = {
    ...explain,
    aiInterpretation: interpretation,
  };

  await prisma.contentTopicScore.update({
    where: { id: scoreRecord.id },
    data: {
      explain: nextExplain as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({
    success: true,
    data: {
      contentId,
      topicId,
      interpretation,
      reused: false,
    },
  });
}
