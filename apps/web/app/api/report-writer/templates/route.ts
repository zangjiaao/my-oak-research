import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { TemplateCreateSchema } from "../schemas";

const wrapResponse = (data: unknown, message?: string) =>
  NextResponse.json({ success: true, data, message });

const wrapError = (message: string, details?: unknown, status = 400) =>
  NextResponse.json(
    {
      success: false,
      error: { message, details },
      data: null,
    },
    { status }
  );

export async function GET() {
  const templates = await prisma.reportTemplate.findMany({
    orderBy: { updatedAt: "desc" },
  });
  return wrapResponse(templates);
}

export async function POST(req: NextRequest) {
  const parsedBody = await req.json().catch(() => ({}));
  const parse = TemplateCreateSchema.safeParse(parsedBody);
  if (!parse.success) {
    return wrapError("Invalid template payload", parse.error.flatten());
  }

  const template = await prisma.reportTemplate.create({
    data: {
      name: parse.data.name,
      description: parse.data.description,
      markdown: parse.data.markdown,
      metadata: parse.data.metadata,
      createdBy: req.headers.get("x-user-id") ?? null,
    },
  });

  return wrapResponse(template, "Template created");
}
