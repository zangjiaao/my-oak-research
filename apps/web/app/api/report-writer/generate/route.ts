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
    const {
      prompt: userPrompt,
      instruction: baseInstruction,
      reportId,
      sessionId: inputSessionId,
      templateId,
      messages,
      materials,
      options
    } = parse.data;

    // 1. Identify or Create ChatSession and Fetch Existing Report
    let sessionId: string | null = inputSessionId || null;
    let existingReportData: any = null;

    if (reportId) {
      existingReportData = await prisma.report.findUnique({
        where: { id: reportId },
        include: { chatSession: true },
      });

      if (existingReportData?.chatSession) {
        sessionId = existingReportData.chatSession.id;
      } else if (existingReportData && !sessionId) {
        const session = await prisma.chatSession.create({
          data: { reportId: existingReportData.id, userId },
        });
        sessionId = session.id;
      }
    }

    if (!sessionId) {
      const session = await prisma.chatSession.create({
        data: {
          userId,
          reportId: reportId || undefined,
          title: userPrompt.slice(0, 50),
        },
      });
      sessionId = session.id;
    }

    // 2. Save User Message immediately
    // Note: We save ONLY the userPrompt (the clean input), not the system instructions
    await prisma.chatMessage.create({
      data: {
        sessionId: sessionId!,
        role: "user",
        content: userPrompt,
      },
    });

    const template = templateId
      ? await prisma.reportTemplate.findUnique({
        where: { id: templateId },
      })
      : null;

    const materialOverview =
      materials
        ?.map(
          (m) =>
            `${m.sourceType}:${m.sourceId} ${m.title ? `(${m.title})` : ""}`
        )
        .join("\n") || "No materials provided.";

    const history = messages
      ?.map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n") || "No previous messages.";

    const currentReportContent = existingReportData
      ? `Title: ${existingReportData.title}
Summary: ${existingReportData.summary || "N/A"}
Content:
${existingReportData.markdown || "N/A"}
`
      : "No existing report content.";

    // Build the instruction for the LLM
    const systemPrompt = [
      "You are a professional report writing assistant.",
      "Your goal is to communicate with the user and help them write or refine reports.",
      "",
      baseInstruction ? `USER BASE REQUIREMENTS:\n${baseInstruction}\n` : null,
      "",
      "CRITICAL INSTRUCTIONS:",
      "1. If the user is just asking questions, chatting, or providing vague ideas, use action: 'REPLY' and provide a helpful response. DO NOT generate or update the report object.",
      "2. If the user explicitly asks to 'generate a report', 'write a draft', or provides enough information to start writing, use action: 'GENERATE_REPORT' and provide both 'reply' and the full 'report' object.",
      "3. If a report draft already exists and the user asks for specific changes, improvements, or additions, use action: 'UPDATE_REPORT' and provide both 'reply' and the updated 'report' object.",
      "",
      "CURRENT REPORT CONTENT:",
      currentReportContent,
      "",
      "CONVERSATION HISTORY:",
      history,
      "",
      template ? `Current Template: ${template.name}` : "No template selected",
      template?.markdown ? `Template content:\n${template.markdown}` : null,
      `Reference Materials:\n${materialOverview}`,
      `Current Request from User: ${stripPromptLike(userPrompt)}`,
      `Output Schema:\n${JSON.stringify(
        {
          action: "REPLY | GENERATE_REPORT | UPDATE_REPORT",
          reply: "string (your response to the user)",
          report: {
            title: "string (report title)",
            summary: "string (150-200 characters executive summary)",
            markdown: "string (the actual body content, DO NOT include the title or summary again)",
            sections: [{ heading: "string", content: "string", references: ["string"] }]
          }
        },
        null,
        2
      )}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const chosenModel = options?.model ?? process.env.LLM_DEFAULT_MODEL ?? "gpt-5";

    let llmResponse: any;
    try {
      llmResponse = await llmGateway.json("report-generate", {
        prompt: systemPrompt,
        model: chosenModel,
        temperature: options?.temperature,
        metadata: redact({
          userId,
          templateId,
          materials,
        }),
      });
    } catch (error) {
      return fail(`LLM gateway error (${chosenModel})`, 502, { detail: error instanceof Error ? error.message : String(error) });
    }

    // 预处理：如果 AI 选择了 REPLY 动作，且 report 对象里的字段都是空的，则将其设置为 null 以通过校验
    if (llmResponse.action === "REPLY" && llmResponse.report) {
      const r = llmResponse.report;
      if (!r.title && !r.summary && !r.markdown) {
        llmResponse.report = null;
      }
    }

    const checked = ReportLLMOutputSchema.safeParse(llmResponse);
    if (!checked.success) {
      console.error("[report-generate] LLM Output validation failed:", JSON.stringify(llmResponse, null, 2));
      console.error("[report-generate] Validation errors:", checked.error.flatten());
      return fail("LLM output invalid", 422, checked.error.flatten());
    }

    const { action, reply, report: llmReport } = checked.data;

    // Save Assistant Response to database
    await prisma.chatMessage.create({
      data: {
        sessionId: sessionId!,
        role: "assistant",
        content: reply,
      },
    });

    // Handle early return for REPLY
    if (action === "REPLY" || !llmReport) {
      const updatedSession = await prisma.chatSession.findUnique({
        where: { id: sessionId! },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });
      return respond({ action, reply, chatSession: updatedSession });
    }

    // Handle Report Generation/Update
    let finalMarkdown = llmReport.markdown;
    if (template?.markdown) {
      finalMarkdown = renderTemplate(template.markdown, {
        title: llmReport.title,
        summary: llmReport.summary,
        markdown: llmReport.markdown,
      });
    }

    let resultReport;
    if (reportId) {
      resultReport = await prisma.report.update({
        where: { id: reportId },
        data: {
          title: llmReport.title,
          summary: llmReport.summary,
          markdown: finalMarkdown,
          metadata: llmReport.sections ? { sections: llmReport.sections } : undefined,
        },
        include: {
          materials: true,
          template: true,
          chatSession: { include: { messages: { orderBy: { createdAt: "asc" } } } },
        },
      });
    } else {
      resultReport = await prisma.report.create({
        data: {
          title: llmReport.title,
          summary: llmReport.summary,
          markdown: finalMarkdown,
          status: "DRAFT",
          templateId,
          authorId: userId,
          metadata: llmReport.sections ? { sections: llmReport.sections } : undefined,
          materials: {
            create: materials?.map((m) => ({
              sourceType: m.sourceType,
              sourceId: m.sourceId,
              title: m.title,
              snippet: m.snippet,
              metadata: m.metadata,
            })) ?? [],
          },
        },
      });

      // Update session to link to the new report
      await prisma.chatSession.update({
        where: { id: sessionId! },
        data: { reportId: resultReport.id },
      });

      resultReport = await prisma.report.findUnique({
        where: { id: resultReport.id },
        include: {
          materials: true,
          template: true,
          chatSession: { include: { messages: { orderBy: { createdAt: "asc" } } } },
        },
      });
    }

    return respond({
      action,
      reply,
      report: resultReport,
    });
  } catch (error: any) {
    console.error("[report-generate] Critical API Error:", error);
    return fail(`生成过程发生解析或连接错误: ${error.message || "未知错误"}`, 500);
  }
}
