import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { llmGateway } from "@oak/agents/llm-gateway";
import type { Prisma } from "@/app/generated/prisma";

const RequestSchema = z.object({
  force: z.boolean().optional().default(false),
});

const RewriteResultSchema = z.object({
  cleanedMarkdown: z.string().min(40).max(6000),
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

function stripLeadingMarkdownHeading(value: string): string {
  return value
    .replace(/^\s*#{1,6}\s+[^\n]+\n+/u, "")
    .trim();
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
  const existingCleanedMarkdown =
    typeof meta.cleanedMarkdown === "string" ? stripNullBytes(meta.cleanedMarkdown) : "";
  if (existingCleanedMarkdown && !parsed.data.force) {
    return NextResponse.json({
      success: true,
      data: {
        contentId,
        cleanedMarkdown: existingCleanedMarkdown,
        updatedAt:
          typeof meta.cleanedMarkdownUpdatedAt === "string"
            ? meta.cleanedMarkdownUpdatedAt
            : null,
        reused: true,
      },
    });
  }

  const rawText = [content.markdown, content.summary].filter(Boolean).join("\n\n").trim();
  if (!rawText) {
    return NextResponse.json({ error: "No content to rewrite" }, { status: 400 });
  }

  const model = process.env.LLM_DEFAULT_MODEL ?? "gpt-5-mini";
  let llmOutput: unknown;
  try {
    llmOutput = await llmGateway.json("follow-content-rewrite", {
      model,
      temperature: 0.2,
      prompt: [
        "你是内容重写助手。",
        "请把输入正文重写为结构化、易读的 Markdown。",
        "要求：",
        "1) 必须严格忠于原文，不得新增原文未出现的事实、背景、观点、推断或结论；",
        "2) 不要补充外部知识；信息缺失处保持留白，不要脑补；",
        "3) 不要输出标题行（不要以 # 开头）；",
        "4) 直接从正文内容开始，可用小标题和列表组织；",
        "5) 长度控制在 800~1600 字，若原文过短则尽量完整但不要扩写；",
        "",
        `平台: ${content.platform}`,
        `时间: ${content.time.toISOString()}`,
        content.url ? `链接: ${content.url}` : null,
        "",
        "原文：",
        rawText.slice(0, 14000),
        "",
        '只返回 JSON: {"cleanedMarkdown":"..."}',
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: {
        contentId,
        mode: "manual-rewrite",
      },
    });
  } catch (error) {
    logger.error("failed to rewrite content markdown", {
      contentId,
      model,
      error: logger.normalizeError(error),
    });
    return NextResponse.json({ error: "AI rewrite failed" }, { status: 502 });
  }

  const checked = RewriteResultSchema.safeParse(llmOutput);
  if (!checked.success) {
    logger.error("invalid content rewrite output", {
      contentId,
      model,
      details: checked.error.flatten(),
    });
    return NextResponse.json({ error: "Invalid AI rewrite result" }, { status: 502 });
  }

  const cleanedMarkdown = stripLeadingMarkdownHeading(
    stripNullBytes(checked.data.cleanedMarkdown)
  );
  const cleanedMarkdownUpdatedAt = new Date().toISOString();
  const updatedMeta: Record<string, unknown> = {
    ...meta,
    cleanedMarkdown,
    cleanedMarkdownUpdatedAt,
    cleanedMarkdownModel: model,
  };

  await prisma.content.update({
    where: { id: contentId },
    data: {
      meta: updatedMeta as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({
    success: true,
    data: {
      contentId,
      cleanedMarkdown,
      updatedAt: cleanedMarkdownUpdatedAt,
      reused: false,
    },
  });
}
