import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { TemplateUpdateSchema } from "../../schemas";

const templateResponse = (data: unknown) =>
  NextResponse.json({ success: true, data });

const errorResponse = (message: string, status = 400, details?: unknown) =>
  NextResponse.json(
    { success: false, error: { message, details }, data: null },
    { status }
  );

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  if (!params.id) {
    return errorResponse("Missing template id");
  }
  const template = await prisma.reportTemplate.findUnique({
    where: { id: params.id },
  });
  if (!template) return errorResponse("Template not found", 404);
  return templateResponse(template);
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  if (!params.id) {
    return errorResponse("Missing template id");
  }
  const body = await req.json().catch(() => ({}));
  const parsed = TemplateUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Invalid payload", 400, parsed.error.flatten());
  }
  const template = await prisma.reportTemplate.update({
    where: { id: params.id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      markdown: parsed.data.markdown,
      metadata: parsed.data.metadata,
    },
  });
  return templateResponse(template);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  if (!params.id) {
    return errorResponse("Missing template id");
  }
  try {
    await prisma.reportTemplate.delete({ where: { id: params.id } });
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error as { code?: string }).code === "P2025"
    ) {
      return errorResponse("Template not found", 404);
    }
    throw error;
  }
  return templateResponse({ id: params.id });
}
