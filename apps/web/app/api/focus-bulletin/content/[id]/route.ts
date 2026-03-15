import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { publishContentEvent } from "@/lib/queue";
import { logger } from "@/lib/logger";

export async function DELETE(
  _req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  const contentId = params.id;

  if (!contentId) {
    return NextResponse.json({ error: "contentId is required" }, { status: 400 });
  }

  const content = await prisma.content.findUnique({
    where: { id: contentId },
    select: { id: true },
  });
  if (!content) {
    return NextResponse.json({ error: "Content not found" }, { status: 404 });
  }

  await prisma.content.delete({
    where: { id: contentId },
  });

  await publishContentEvent({
    type: "content:deleted",
    contentId,
    at: new Date().toISOString(),
  }).catch((error) => {
    logger.error("failed to publish content deleted event", {
      contentId,
      error: logger.normalizeError(error),
    });
  });

  return NextResponse.json({ success: true });
}
