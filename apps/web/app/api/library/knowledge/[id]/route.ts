import { NextRequest } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { json, badRequest, serverError, notFound } from "@/app/api/_utils/http";
import { deleteFile } from "@/lib/storage";

const UpdateKnowledgeSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
});

// TODO: 从认证系统获取 userId，目前使用临时方案
function getUserId(): string {
  return process.env.DEFAULT_USER_ID || "default-user-id";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = getUserId();

    const knowledge = await prisma.knowledge.findFirst({
      where: {
        id,
        ownerId: userId,
      },
      include: {
        files: {
          orderBy: {
            createdAt: "desc",
          },
        },
      knowledgeChunks: {
        select: {
          id: true,
          chunkIndex: true,
          content: true,
          metadata: true,
          createdAt: true,
          fileId: true,
        },
          orderBy: {
            chunkIndex: "asc",
          },
        },
      },
    });

    if (!knowledge) {
      return notFound("Knowledge not found");
    }

    const chunkCountMap = knowledge.knowledgeChunks.reduce<Record<string, number>>(
      (acc, chunk) => {
        if (chunk.fileId) {
          acc[chunk.fileId] = (acc[chunk.fileId] ?? 0) + 1;
        }
        return acc;
      },
      {}
    );

    return json({
      success: true,
      data: {
        id: knowledge.id,
        name: knowledge.name,
        description: knowledge.description,
        createdAt: knowledge.createdAt.toISOString(),
        updatedAt: knowledge.updatedAt.toISOString(),
        files: knowledge.files.map((file) => ({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          createdAt: file.createdAt.toISOString(),
          chunkCount: chunkCountMap[file.id] ?? 0,
        })),
        chunks: knowledge.knowledgeChunks,
        chunkCount: knowledge.knowledgeChunks.length,
      },
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = getUserId();
    const body = await request.json().catch(() => ({}));
    const parsed = UpdateKnowledgeSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("Invalid payload", parsed.error.flatten());
    }

    // 检查知识库是否存在且属于当前用户
    const existing = await prisma.knowledge.findFirst({
      where: {
        id,
        ownerId: userId,
      },
    });

    if (!existing) {
      return notFound("Knowledge not found");
    }

    // 如果更新名称，检查新名称是否已存在
    if (parsed.data.name && parsed.data.name !== existing.name) {
      const nameExists = await prisma.knowledge.findFirst({
        where: {
          name: parsed.data.name,
          ownerId: userId,
          id: { not: id },
        },
      });

      if (nameExists) {
        return json({ error: "Knowledge with this name already exists" }, 409);
      }
    }

    const updated = await prisma.knowledge.update({
      where: { id },
      data: {
        name: parsed.data.name,
        description: parsed.data.description ?? undefined,
      },
      include: {
        files: {
          select: { id: true },
        },
        knowledgeChunks: {
          select: { id: true },
        },
      },
    });

    return json({
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        fileCount: updated.files.length,
        chunkCount: updated.knowledgeChunks.length,
      },
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = getUserId();

    // 检查知识库是否存在且属于当前用户，同时获取文件列表
    const existing = await prisma.knowledge.findFirst({
      where: {
        id,
        ownerId: userId,
      },
      include: {
        files: {
          select: {
            id: true,
            storageKey: true,
          },
        },
      },
    });

    if (!existing) {
      return notFound("Knowledge not found");
    }

    // 删除 MinIO 中的文件
    for (const file of existing.files) {
      if (file.storageKey) {
        try {
          await deleteFile(file.storageKey);
        } catch (error) {
          console.error(
            `Failed to delete file from MinIO: ${file.storageKey}`,
            error
          );
          // 继续删除其他文件，不中断流程
        }
      }
    }

    // 删除知识库（级联删除文件和切片）
    await prisma.knowledge.delete({
      where: { id },
    });

    return json({
      success: true,
      data: { deleted: true },
    });
  } catch (error) {
    return serverError(error);
  }
}
