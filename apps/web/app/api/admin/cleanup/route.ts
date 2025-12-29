import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    console.log("--- Starting Admin Orphan Cleanup ---");

    const knowledgeId = "cmjl5tawj0004y040dgf4uog0";

    // 1. Get all valid file IDs for this knowledge
    const validFiles = await prisma.knowledgeFile.findMany({
      where: { knowledgeId },
      select: { id: true }
    });
    const validFileIds = validFiles.map(f => f.id);

    // 2. Find ALL chunks for this knowledge
    const allChunks = await prisma.knowledgeChunk.findMany({
      where: { knowledgeId },
      select: { id: true, fileId: true }
    });

    // 3. Identify orphans: chunks whose fileId is NOT in validFileIds
    const orphans = allChunks.filter(c => !c.fileId || !validFileIds.includes(c.fileId));

    let deletedCount = 0;
    if (orphans.length > 0) {
      const deleted = await prisma.knowledgeChunk.deleteMany({
        where: {
          id: { in: orphans.map(o => o.id) }
        }
      });
      deletedCount = deleted.count;
    }

    // 4. Update knowledge timestamp
    await prisma.knowledge.update({
      where: { id: knowledgeId },
      data: { updatedAt: new Date() }
    });

    return NextResponse.json({
      success: true,
      totalChunksBefore: allChunks.length,
      validFilesCount: validFileIds.length,
      orphansFound: orphans.length,
      deleted: deletedCount,
      message: `Cleaned up ${deletedCount} orphan chunks.`
    });
  } catch (error: any) {
    console.error("Cleanup error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
