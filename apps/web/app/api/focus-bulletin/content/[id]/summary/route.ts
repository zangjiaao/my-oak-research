import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { llmGateway } from "@oak/agents/llm-gateway";
import type { Prisma } from "@/app/generated/prisma";
import { resolveActiveContentState } from "@/lib/follow-content/active-content-state";

const RequestSchema = z.object({
  force: z.boolean().optional().default(false),
});

const SummaryResultSchema = z.object({
  summary: z.string().min(30).max(600),
});

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function stripNullBytes(value: string): string {
  return value.replace(/\u0000/g, "").trim();
}

export async function POST(
  req: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  const contentId = params.id;
  if (!contentId) {
    return NextResponse.json({ error: "contentId is required" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const content = await prisma.content.findUnique({
    where: { id: contentId },
    select: {
      id: true,
      title: true,
      summary: true,
      markdown: true,
      platform: true,
      url: true,
      time: true,
      meta: true,
    },
  });
  if (!content) {
    return NextResponse.json({ error: "Content not found" }, { status: 404 });
  }

  const meta = asObject(content.meta);
  const existingAiSummary =
    typeof meta.aiSummary === "string" ? stripNullBytes(meta.aiSummary) : "";
  if (existingAiSummary && !parsed.data.force) {
    return NextResponse.json({
      success: true,
      data: {
        contentId,
        summary: existingAiSummary,
        updatedAt:
          typeof meta.aiSummaryUpdatedAt === "string"
            ? meta.aiSummaryUpdatedAt
            : null,
        reused: true,
      },
    });
  }

  const activeState = resolveActiveContentState({
    title: content.title,
    summary: content.summary,
    markdown: content.markdown,
    meta: content.meta,
  });
  const contentText = activeState.activeText;
  if (!contentText) {
    return NextResponse.json({ error: "No content to summarize" }, { status: 400 });
  }

  const model = process.env.LLM_DEFAULT_MODEL ?? "gpt-5-mini";
  let llmOutput: unknown;
  try {
    llmOutput = await llmGateway.json("follow-content-summary", {
      model,
      temperature: 0.2,
      prompt: [
        "你是一个专业的信息分析助手。",
        "请输出一段简洁中文摘要，面向情报阅读场景。",
        "要求：",
        "1) 只保留关键事实，不要编造；",
        "2) 120~220字，最多2段；",
        "3) 不要输出标题、前缀、项目符号；",
        "4) 如果内容本身信息不足，明确指出信息有限。",
        "",
        `平台: ${content.platform}`,
        `时间: ${content.time.toISOString()}`,
        content.url ? `链接: ${content.url}` : null,
        "",
        `当前标题: ${activeState.activeTitle}`,
        activeState.activeSummaryHint
          ? `当前摘要线索: ${activeState.activeSummaryHint}`
          : null,
        "",
        "原始内容：",
        contentText.slice(0, 12000),
        "",
        '只返回 JSON: {"summary":"..."}',
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: {
        contentId,
        mode: "manual-summary",
      },
    });
  } catch (error) {
    logger.error("failed to generate content summary", {
      contentId,
      model,
      error: logger.normalizeError(error),
    });
    return NextResponse.json({ error: "AI summary generation failed" }, { status: 502 });
  }

  const checked = SummaryResultSchema.safeParse(llmOutput);
  if (!checked.success) {
    logger.error("invalid content summary output", {
      contentId,
      model,
      details: checked.error.flatten(),
    });
    return NextResponse.json({ error: "Invalid AI summary result" }, { status: 502 });
  }

  const summary = stripNullBytes(checked.data.summary);
  const aiSummaryUpdatedAt = new Date().toISOString();
  const updatedMeta: Record<string, unknown> = {
    ...meta,
    aiSummary: summary,
    aiSummaryUpdatedAt,
    aiSummaryModel: model,
  };
  const recordContent = asObject(updatedMeta.recordContent);
  const summaryView = asObject(recordContent.summaryView);
  updatedMeta.recordContent = {
    ...recordContent,
    summaryView: {
      ...summaryView,
      summary,
    },
  };

  await prisma.content.update({
    where: { id: contentId },
    data: {
      summary,
      meta: updatedMeta as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({
    success: true,
    data: {
      contentId,
      summary,
      updatedAt: aiSummaryUpdatedAt,
      reused: false,
    },
  });
}
