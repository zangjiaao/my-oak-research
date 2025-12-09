import { NextRequest } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { json, badRequest, serverError, notFound } from "@/app/api/_utils/http";
import { uploadFile, generateStorageKey } from "@/lib/storage";
import { knowledgeQueue, defaultJobOpts } from "@/lib/queue";

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
    // 注意：Postman 在处理中文文件名时可能存在编码问题
    // Next.js 的 formData() 在某些情况下无法正确解析包含非 ASCII 字符的文件名
    let formData: FormData;
    let file: File | null = null;
    let vectorModel: string | undefined;
    let chunkSize: string | undefined;

    try {
      formData = await request.formData();
      file = formData.get("file") as File | null;
      vectorModel = formData.get("vectorModel")?.toString();
      chunkSize = formData.get("chunkSize")?.toString();
    } catch (error) {
      // FormData 解析失败，通常是编码问题
      console.error("FormData parsing failed:", error);

      // 检查是否是编码相关的错误
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("CRLF") || errorMessage.includes("FormData")) {
        return badRequest(
          "文件上传失败：检测到文件名编码问题。\n" +
            "解决方案：\n" +
            "1. 在 Postman 中，请确保文件名的 Content-Disposition header 使用正确的编码格式\n" +
            "2. 或者将文件重命名为仅包含英文字母、数字和常见符号的名称\n" +
            "3. 或者使用浏览器或 curl 命令上传文件\n" +
            "\n" +
            "使用 curl 上传示例：\n" +
            `curl -X POST "http://localhost:3000/api/library/knowledge/${id}/upload" \\\n` +
            `  -F "file=@your-file.pdf" \\\n` +
            `  -F "vectorModel=Doubao-embedding-240715" \\\n` +
            `  -F "chunkSize=500"`
        );
      }

      // 其他错误直接抛出
      throw error;
    }

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

    await knowledgeQueue.add(
      "process",
      {
        knowledgeId: id,
        fileId: knowledgeFile.id,
        storageKey,
        vectorModel: config.data.vectorModel,
        chunkSize: config.data.chunkSize,
      },
      {
        jobId: knowledgeFile.id,
        ...defaultJobOpts,
      }
    );

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
