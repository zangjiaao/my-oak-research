import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { getFileUrl, deleteFile } from "@/lib/storage";
import { json, notFound, badRequest, serverError } from "@/app/api/_utils/http";

// TODO: 从认证系统获取 userId，目前使用临时方案
function getUserId(): string {
  return process.env.DEFAULT_USER_ID || "default-user-id";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const { id, fileId } = await params;
    const userId = getUserId();

    const knowledgeFile = await prisma.knowledgeFile.findFirst({
      where: {
        id: fileId,
        knowledgeId: id,
        knowledge: {
          ownerId: userId,
        },
      },
    });

    if (!knowledgeFile) {
      return notFound("Knowledge file not found");
    }

    if (!knowledgeFile.storageKey) {
      return badRequest("File storage key missing");
    }

    const url = await getFileUrl(knowledgeFile.storageKey);

    return json({
      success: true,
      data: {
        url,
        fileName: knowledgeFile.name,
      },
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const { id, fileId } = await params;
    const userId = getUserId();

    const knowledgeFile = await prisma.knowledgeFile.findFirst({
      where: {
        id: fileId,
        knowledgeId: id,
        knowledge: {
          ownerId: userId,
        },
      },
    });

    if (!knowledgeFile) {
      return notFound("Knowledge file not found");
    }

    if (knowledgeFile.storageKey) {
      try {
        await deleteFile(knowledgeFile.storageKey);
      } catch (error) {
        console.error(
          `Failed to delete file from storage: ${knowledgeFile.storageKey}`,
          error
        );
        // 继续删除数据库记录，不阻塞
      }
    }

    // 1. Delete associated chunks first (since there's no cascade in schema)
    await prisma.knowledgeChunk.deleteMany({
      where: { fileId: fileId },
    });

    // 2. Delete the file record
    await prisma.knowledgeFile.delete({
      where: { id: fileId },
    });

    // 3. Update knowledge timestamp
    await prisma.knowledge.update({
      where: { id: id },
      data: { updatedAt: new Date() },
    });

    return json({
      success: true,
      data: {
        deleted: true,
        fileId,
      },
    });
  } catch (error) {
    return serverError(error);
  }
}
