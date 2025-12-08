import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ReportUpdateSchema } from "../../schemas";

const respond = (data: unknown) => NextResponse.json({ success: true, data });

const fail = (message: string, status = 400, details?: unknown) =>
  NextResponse.json(
    { success: false, error: { message, details }, data: null },
    { status }
  );

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  if (!params.id) {
    return fail("Missing report id");
  }
  const report = await prisma.report.findUnique({
    where: { id: params.id },
    include: { materials: true, template: true },
  });
  if (!report) return fail("Report not found", 404);
  return respond(report);
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  if (!params.id) {
    return fail("Missing report id");
  }
  const body = await req.json().catch(() => ({}));
  const parse = ReportUpdateSchema.safeParse(body);
  if (!parse.success) {
    return fail("Invalid payload", 400, parse.error.flatten());
  }
  let report;
  try {
    report = await prisma.report.update({
      where: { id: params.id },
      data: {
        title: parse.data.title,
        summary: parse.data.summary,
        markdown: parse.data.markdown,
        status: parse.data.status,
        templateId: parse.data.templateId,
        metadata: parse.data.metadata,
      },
      include: {
        materials: true,
        template: true,
      },
    });
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error as { code?: string }).code === "P2025"
    ) {
      return fail("Report not found", 404);
    }
    throw error;
  }
  return respond(report);
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  if (!params.id) {
    return fail("Missing report id");
  }
  try {
    await prisma.report.delete({ where: { id: params.id } });
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error as { code?: string }).code === "P2025"
    ) {
      return fail("Report not found", 404);
    }
    throw error;
  }
  return respond({ id: params.id });
}
