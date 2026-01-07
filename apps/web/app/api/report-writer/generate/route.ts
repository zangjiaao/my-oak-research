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
  try {
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
            `${material.sourceType}:${material.sourceId} ${material.title ? `(${material.title})` : ""
            }`
        )
        .join("\n") || "No materials provided.";

    const history = parse.data.messages
      ?.map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n") || "No previous messages.";

    const prompt = [
      "You are a professional report writing assistant.",
      "Your goal is to communicate with the user and help them write or refine reports.",
      "",
      "CRITICAL INSTRUCTIONS:",
      "1. If the user is just asking questions, chatting, or providing vague ideas, use action: 'REPLY' and provide a helpful response. DO NOT generate or update the report object.",
      "2. If the user explicitly asks to 'generate a report', 'write a draft', or provides enough information to start writing, use action: 'GENERATE_REPORT' and provide both 'reply' and the full 'report' object.",
      "3. If a report draft already exists and the user asks for specific changes, improvements, or additions, use action: 'UPDATE_REPORT' and provide both 'reply' and the updated 'report' object.",
      "",
      "CONVERSATION HISTORY:",
      history,
      "",
      template ? `Current Template: ${template.name}` : "No template selected",
      template?.markdown ? `Template content:\n${template.markdown}` : null,
      `Reference Materials:\n${materialOverview}`,
      `Current Instruction: ${stripPromptLike(parse.data.prompt)}`,
      `Output Schema:\n${JSON.stringify(
        {
          action: "REPLY | GENERATE_REPORT | UPDATE_REPORT",
          reply: "string (your response to the user)",
          report: {
            title: "string",
            summary: "string (150-200 characters)",
            markdown: "string (full body)",
            sections: [{ heading: "string", content: "string", references: ["string"] }]
          }
        },
        null,
        2
      )}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const chosenModel =
      parse.data.options?.model ?? process.env.LLM_DEFAULT_MODEL ?? "gpt-5";

    let llmResponse: any;
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

    const { action, reply, report: llmReport } = checked.data;

    // 如果只是回复，直接返回
    if (action === "REPLY" || !llmReport) {
      return respond({ action, reply });
    }

    // 处理报告内容（模版渲染）
    let finalMarkdown = llmReport.markdown;
    if (template?.markdown) {
      finalMarkdown = renderTemplate(template.markdown, {
        title: llmReport.title,
        summary: llmReport.summary,
        markdown: llmReport.markdown,
      });
    }

    // 创建或更新报告记录（如果业务逻辑需要，可以根据输入参数判断是 create 还是 update）
    // 这里暂时保持原有的 create 逻辑，或者根据后续需求调整
    const dbReport = await prisma.report.create({
      data: {
        title: llmReport.title,
        summary: llmReport.summary,
        markdown: finalMarkdown,
        status: "DRAFT",
        templateId: parse.data.templateId,
        authorId: userId,
        metadata: llmReport.sections
          ? { sections: llmReport.sections }
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

    return respond({
      action,
      reply,
      report: dbReport,
    });
  } catch (error: any) {
    console.error("[report-generate] Critical API Error:", error);
    return fail(
      `生成过程发生解析或连接错误: ${error.message || "未知错误"}`,
      500
    );
  }
}
