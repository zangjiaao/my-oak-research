import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { llmGateway } from "@oak/agents/llm-gateway";
import { stripPromptLike, redact } from "@/lib/security";
import { ReportGenerateSchema, ReportLLMOutputSchema } from "../schemas";
import { renderTemplate } from "@/lib/template";

const respond = (data: unknown) => NextResponse.json({ success: true, data });

const fail = (message: string, status = 400, details?: unknown) =>
  NextResponse.json(
    { success: false, error: { message, details }, data: null },
    { status }
  );

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parse = ReportGenerateSchema.safeParse(body);
  if (!parse.success) {
    return fail("Invalid request", 400, parse.error.flatten());
  }

  const userId = req.headers.get("x-user-id") ?? null;

  const template = parse.data.templateId
    ? await prisma.reportTemplate.findUnique({
        where: { id: parse.data.templateId },
      })
    : null;

  if (parse.data.templateId && !template) {
    return fail("Template not found", 404);
  }

  const materialOverview =
    parse.data.materials
      ?.map(
        (material) =>
          `${material.sourceType}:${material.sourceId} ${
            material.title ? `(${material.title})` : ""
          }`
      )
      .join("\n") || "No materials provided.";

  const prompt = [
    template ? `Template: ${template.name}` : "No template selected",
    template?.markdown ? `Template content:\n${template.markdown}` : null,
    `Materials:\n${materialOverview}`,
    `Task:\n${stripPromptLike(parse.data.prompt)}`,
    `Output format:\n${JSON.stringify(
      {
        title: "string (report title)",
        summary: "string (plain-text summary, 150-200 characters)",
        markdown: "string (full report body in Markdown)",
        sections: [
          {
            heading: "string",
            content: "string",
            references: ["string"],
          },
        ],
      },
      null,
      2
    )}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const chosenModel =
    parse.data.options?.model ?? process.env.LLM_DEFAULT_MODEL ?? "gpt-5";

  let llmResponse: unknown;
  try {
    llmResponse = await llmGateway.json("report-generate", {
      prompt,
      model: chosenModel,
      temperature: parse.data.options?.temperature,
      metadata: redact({
        userId,
        templateId: parse.data.templateId,
        materials: parse.data.materials,
      }),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error when calling LLM gateway";
    const isClientError = /4\d{2}/.test(message);
    return fail(
      `LLM gateway error (${chosenModel})`,
      isClientError ? 422 : 502,
      { detail: message }
    );
  }

  const checked = ReportLLMOutputSchema.safeParse(llmResponse);
  if (!checked.success) {
    return fail("LLM output invalid", 422, checked.error.flatten());
  }

  // 如果使用了模板，应用模板变量替换
  let finalMarkdown = checked.data.markdown;
  if (template?.markdown) {
    finalMarkdown = renderTemplate(template.markdown, {
      title: checked.data.title,
      summary: checked.data.summary,
      markdown: checked.data.markdown,
    });
  }

  const report = await prisma.report.create({
    data: {
      title: checked.data.title,
      summary: checked.data.summary,
      markdown: finalMarkdown,
      status: "DRAFT",
      templateId: parse.data.templateId,
      authorId: userId,
      metadata: checked.data.sections
        ? { sections: checked.data.sections }
        : undefined,
      materials: {
        create:
          parse.data.materials?.map((material) => ({
            sourceType: material.sourceType,
            sourceId: material.sourceId,
            title: material.title,
            snippet: material.snippet,
            metadata: material.metadata,
          })) ?? [],
      },
    },
    include: {
      materials: true,
      template: true,
    },
  });

  return respond(report);
}
