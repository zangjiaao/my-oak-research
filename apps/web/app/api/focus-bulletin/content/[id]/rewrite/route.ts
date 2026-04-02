import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { Prisma } from "@/app/generated/prisma";

const RequestSchema = z.object({
  force: z.boolean().optional().default(false),
  provider: z.literal("jina").optional().default("jina"),
});

const JinaResponseSchema = z.object({
  code: z.number().optional(),
  status: z.number().optional(),
  data: z
    .object({
      title: z.string().optional().nullable(),
      description: z.string().optional().nullable(),
      url: z.string().optional().nullable(),
      content: z.string().optional().nullable(),
      publishedTime: z.string().optional().nullable(),
      metadata: z.record(z.string(), z.unknown()).optional().nullable(),
      usage: z
        .object({
          tokens: z.number().optional().nullable(),
        })
        .optional()
        .nullable(),
    })
    .optional()
    .nullable(),
  meta: z
    .object({
      usage: z
        .object({
          tokens: z.number().optional().nullable(),
        })
        .optional()
        .nullable(),
    })
    .optional()
    .nullable(),
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

function asString(value: unknown): string {
  return typeof value === "string" ? stripNullBytes(value) : "";
}

async function fetchJinaByUrl(url: string) {
  const jinaBaseUrl = process.env.JINA_BASE_URL ?? "https://r.jina.ai";
  const jinaApiKey = process.env.JINA_API_KEY ?? "";
  const timeoutMs = Math.max(3000, Number(process.env.JINA_TIMEOUT_MS ?? 15000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(jinaBaseUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(jinaApiKey ? { Authorization: `Bearer ${jinaApiKey}` } : {}),
      },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    return { ok: response.ok, status: response.status, bodyText };
  } finally {
    clearTimeout(timer);
  }
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
  const existingCleanedMarkdown = asString(meta.jinaContent || meta.cleanedMarkdown);
  const existingTitle = asString(meta.jinaTitle || meta.cleanedTitle || content.title);
  const existingDescription = asString(meta.jinaDescription || meta.cleanedSummary || content.summary);
  if (existingCleanedMarkdown && !parsed.data.force) {
    return NextResponse.json({
      success: true,
      data: {
        contentId,
        provider: "jina",
        title: existingTitle || null,
        description: existingDescription || null,
        cleanedMarkdown: existingCleanedMarkdown,
        updatedAt:
          typeof meta.jinaUpdatedAt === "string"
            ? meta.jinaUpdatedAt
            : typeof meta.cleanedMarkdownUpdatedAt === "string"
              ? meta.cleanedMarkdownUpdatedAt
            : null,
        reused: true,
      },
    });
  }

  if (!content.url?.trim()) {
    return NextResponse.json({ error: "No source url for Jina enrich" }, { status: 400 });
  }

  let jinaResult: Awaited<ReturnType<typeof fetchJinaByUrl>>;
  try {
    jinaResult = await fetchJinaByUrl(content.url);
  } catch (error) {
    logger.error("failed to enrich content with jina", {
      contentId,
      url: content.url,
      error: logger.normalizeError(error),
    });
    return NextResponse.json({ error: "Jina enrich failed" }, { status: 502 });
  }

  if (!jinaResult.ok) {
    logger.error("jina enrich returned non-200", {
      contentId,
      url: content.url,
      statusCode: jinaResult.status,
      bodyPreview: jinaResult.bodyText.slice(0, 400),
    });
    return NextResponse.json(
      { error: `Jina enrich failed (${jinaResult.status})` },
      { status: 502 }
    );
  }

  let parsedJinaBody: unknown = {};
  try {
    parsedJinaBody = JSON.parse(jinaResult.bodyText || "{}");
  } catch (error) {
    logger.error("failed to parse jina response body", {
      contentId,
      url: content.url,
      error: logger.normalizeError(error),
      bodyPreview: jinaResult.bodyText.slice(0, 400),
    });
    return NextResponse.json({ error: "Invalid Jina response body" }, { status: 502 });
  }
  const checked = JinaResponseSchema.safeParse(parsedJinaBody);
  if (!checked.success) {
    logger.error("invalid jina enrich output", {
      contentId,
      details: checked.error.flatten(),
    });
    return NextResponse.json({ error: "Invalid Jina result" }, { status: 502 });
  }

  const jinaData = checked.data.data ?? {};
  const jinaContent = stripLeadingMarkdownHeading(asString(jinaData.content));
  const jinaTitle = asString(jinaData.title);
  const jinaDescription = asString(jinaData.description);
  const usageTokens =
    (typeof jinaData.usage?.tokens === "number" ? jinaData.usage.tokens : null) ??
    (typeof checked.data.meta?.usage?.tokens === "number"
      ? checked.data.meta.usage.tokens
      : null);

  if (!jinaContent) {
    return NextResponse.json(
      { error: "Jina returned empty content" },
      { status: 422 }
    );
  }

  const cleanedMarkdown = stripLeadingMarkdownHeading(
    jinaContent
  );
  const cleanedMarkdownUpdatedAt = new Date().toISOString();
  const updatedMeta: Record<string, unknown> = {
    ...meta,
    jinaTitle: jinaTitle || null,
    jinaDescription: jinaDescription || null,
    jinaContent: cleanedMarkdown,
    jinaMetadata: jinaData.metadata ?? null,
    jinaSourceUrl: asString(jinaData.url) || content.url,
    jinaPublishedTime: asString(jinaData.publishedTime) || null,
    jinaUsageTokens: usageTokens,
    jinaUpdatedAt: cleanedMarkdownUpdatedAt,
    cleanedMarkdown,
    cleanedTitle: jinaTitle || content.title,
    cleanedSummary: jinaDescription || content.summary,
    cleanedMarkdownUpdatedAt,
    cleanedMarkdownModel: "jina.ai",
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
      provider: "jina",
      title: jinaTitle || null,
      description: jinaDescription || null,
      cleanedMarkdown,
      updatedAt: cleanedMarkdownUpdatedAt,
      reused: false,
    },
  });
}
