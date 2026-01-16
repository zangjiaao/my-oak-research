import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ReportCreateSchema, ReportListQuerySchema } from "../schemas";

const respond = (data: unknown, meta?: Record<string, unknown>) =>
  NextResponse.json({ success: true, data, meta });

const fail = (message: string, status = 400, details?: unknown) =>
  NextResponse.json(
    { success: false, error: { message, details }, data: null },
    { status }
  );

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parse = ReportListQuerySchema.safeParse(
    Object.fromEntries(url.searchParams.entries())
  );
  if (!parse.success) {
    return fail("Invalid query", 400, parse.error.flatten());
  }

  const { status, page, pageSize } = parse.data;
  const where = status ? { status } : {};
  const total = await prisma.report.count({ where });
  const items = await prisma.report.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: {
      materials: true,
      template: true,
    },
  });

  return respond(items, { page, pageSize, total });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parse = ReportCreateSchema.safeParse(body);
  if (!parse.success) {
    return fail("Invalid report payload", 400, parse.error.flatten());
  }
  const userId = req.headers.get("x-user-id") ?? null;
  const data = parse.data;

  const materials =
    data.materials?.map((material) => ({
      sourceType: material.sourceType,
      sourceId: material.sourceId,
      title: material.title,
      snippet: material.snippet,
      metadata: material.metadata,
    })) ?? [];

  const report = await prisma.report.create({
    data: {
      title: data.title,
      summary: data.summary,
      markdown: data.markdown,
      status: data.status,
      templateId: data.templateId,
      metadata: data.metadata,
      authorId: userId,
      materials: {
        create: materials,
      },
    },
    include: {
      materials: true,
      template: true,
    },
  });

  return respond(report, { message: "Report created" });
}
