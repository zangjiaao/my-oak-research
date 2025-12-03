import { NextRequest } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { json, badRequest, serverError, notFound } from "@/app/api/_utils/http";
import { uploadFile, generateStorageKey } from "@/lib/storage";

const UploadConfigSchema = z.object({
  vectorModel: z.string().optional().default("Doubao-embedding-240715"),
  chunkSize: z.coerce.number().int().min(200).max(2000).default(500),
});

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
];

// TODO: 从认证系统获取 userId，目前使用临时方案
function getUserId(): string {
  return process.env.DEFAULT_USER_ID || "default-user-id";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = getUserId();

    // 检查知识库是否存在且属于当前用户
    const knowledge = await prisma.knowledge.findFirst({
      where: {
        id,
        ownerId: userId,
      },
    });

    if (!knowledge) {
      return notFound("Knowledge not found");
    }

    // 解析 FormData
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const vectorModel = formData.get("vectorModel")?.toString();
    const chunkSize = formData.get("chunkSize")?.toString();

    if (!file) {
      return badRequest("File is required");
    }

    // 验证文件大小
    if (file.size > MAX_FILE_SIZE) {
      return badRequest(
        `File size exceeds maximum limit of ${MAX_FILE_SIZE / 1024 / 1024}MB`
      );
    }

    // 验证文件类型
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return badRequest(
        `File type not allowed. Allowed types: PDF, Word, TXT, Markdown`
      );
    }

    // 解析配置
    const config = UploadConfigSchema.safeParse({
      vectorModel,
      chunkSize,
    });

    if (!config.success) {
      return badRequest("Invalid upload configuration", config.error.flatten());
    }

    // 读取文件内容
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 先创建文件记录（获取 fileId）
    const knowledgeFile = await prisma.knowledgeFile.create({
      data: {
        knowledgeId: id,
        name: file.name,
        mimeType: file.type,
        size: file.size,
        storageKey: null, // 稍后更新
      },
    });

    // 生成存储键并上传到 MinIO
    const storageKey = generateStorageKey(id, knowledgeFile.id, file.name);

    try {
      await uploadFile(storageKey, buffer, file.type, {
        knowledgeId: id,
        fileId: knowledgeFile.id,
        originalName: file.name,
        vectorModel: config.data.vectorModel,
        chunkSize: String(config.data.chunkSize),
      });

      // 更新文件记录，保存存储键
      await prisma.knowledgeFile.update({
        where: { id: knowledgeFile.id },
        data: { storageKey },
      });
    } catch (uploadError) {
      // 如果上传失败，删除已创建的文件记录
      await prisma.knowledgeFile.delete({
        where: { id: knowledgeFile.id },
      });
      throw uploadError;
    }

    // TODO: 这里应该将文件处理和向量化任务提交到 worker 队列
    // 示例：await enqueueJob("knowledge-process", {
    //   fileId: knowledgeFile.id,
    //   storageKey,
    //   config: config.data
    // });

    return json({
      success: true,
      data: {
        fileId: knowledgeFile.id,
        fileName: knowledgeFile.name,
        storageKey,
        message: "File uploaded successfully. Processing will start shortly.",
      },
    });
  } catch (error) {
    return serverError(error);
  }
}
