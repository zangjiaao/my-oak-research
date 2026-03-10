import crypto from "crypto";
import { createKnowledgeWorker, publishTaskEvent } from "@/lib/queue";
import prisma from "@/lib/prisma";
import { downloadFile } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { createEmbeddings } from "@oak/agents/embeddings";
const { PDFParse } = require("pdf-parse");

export const knowledgeWorker = createKnowledgeWorker(async (job) => {
  const { knowledgeId, fileId, storageKey, vectorModel, chunkSize } = job.data;

  try {
    logger.info("knowledge job started", { fileId, knowledgeId });

    await publishTaskEvent(fileId, {
      type: "knowledge:enqueue",
      message: "知识库切片任务已入队",
      knowledgeId,
      fileId,
    });

    const knowledgeFile = await prisma.knowledgeFile.findUnique({
      where: { id: fileId },
      include: {
        knowledge: true,
      },
    });

    if (!knowledgeFile) {
      throw new Error(`Knowledge file ${fileId} not found`);
    }

    // 0. Cleanup old chunks if any (Ensures a clean state if retrying after partial failure)
    await prisma.knowledgeChunk.deleteMany({
      where: { fileId },
    });

    logger.info("knowledge metadata loaded", {
      fileId,
      knowledgeId,
      size: knowledgeFile.size,
    });

    const buffer = await downloadFile(storageKey);
    const text = await extractText(buffer, knowledgeFile.mimeType, knowledgeFile.name);

    const chunks = splitTextIntoChunks(text, chunkSize);
    if (!chunks.length) {
      throw new Error("无法从文档中提取文本内容");
    }

    await publishTaskEvent(fileId, {
      type: "knowledge:chunk",
      message: `开始处理 ${chunks.length} 个切片...`,
    });
    logger.info("knowledge chunks created", {
      fileId,
      knowledgeId,
      chunkCount: chunks.length,
    });

    // Super Batch process: Embed -> Save -> Progress
    const WORK_BATCH_SIZE = 100;

    for (let i = 0; i < chunks.length; i += WORK_BATCH_SIZE) {
      const currentBatch = chunks.slice(i, i + WORK_BATCH_SIZE);

      // 1. Get Embeddings
      const embeddings = await createEmbeddings(currentBatch, vectorModel).catch(err => {
        throw new Error(`向量生成失败: ${err.message}`);
      });

      // 2. Save Chunks (Bulk insert for maximum performance and stability)
      const DB_BATCH_SIZE = 20;
      for (let k = 0; k < currentBatch.length; k += DB_BATCH_SIZE) {
        const subBatch = currentBatch.slice(k, k + DB_BATCH_SIZE);

        // Construct bulk insert SQL
        const placeholders: string[] = [];
        const values: any[] = [];

        subBatch.forEach((content, index) => {
          const localBatchIndex = k + index;
          const globalIndex = i + localBatchIndex;
          const embedding = embeddings[localBatchIndex];
          const vectorString = `[${embedding.join(",")}]`;
          const baseIdx = index * 7;

          placeholders.push(`($${baseIdx + 1}, $${baseIdx + 2}, $${baseIdx + 3}, $${baseIdx + 4}, $${baseIdx + 5}::jsonb, $${baseIdx + 6}::vector, $${baseIdx + 7}, NOW())`);

          values.push(
            crypto.randomUUID(),
            knowledgeId,
            fileId,
            content,
            JSON.stringify({
              fileName: knowledgeFile.name,
              fileId,
              chunkIndex: globalIndex,
              chunkSize,
              knowledgeName: knowledgeFile.knowledge?.name,
            }),
            vectorString,
            globalIndex
          );
        });

        const sql = `
          INSERT INTO "KnowledgeChunk" ("id", "knowledgeId", "fileId", "content", "metadata", "embedding", "chunkIndex", "createdAt")
          VALUES ${placeholders.join(", ")}
        `;

        await prisma.$executeRawUnsafe(sql, ...values).catch(err => {
          logger.error("knowledge chunk bulk insert failed", {
            fileId,
            knowledgeId,
            batchStartIndex: i + k,
            error: logger.normalizeError(err),
          });
          throw new Error(`数据库存入失败: ${err.message}`);
        });
      }

      // Update UI Progress
      const processed = Math.min(i + WORK_BATCH_SIZE, chunks.length);
      await publishTaskEvent(fileId, {
        type: "knowledge:progress",
        message: `正在向量化并保存: ${processed} / ${chunks.length}`,
        progress: Math.floor((processed / chunks.length) * 100),
        chunkCount: processed,
      });
    }

    await prisma.knowledge.update({
      where: { id: knowledgeId },
      data: { updatedAt: new Date() },
    });

    await publishTaskEvent(fileId, {
      type: "knowledge:done",
      message: "知识库切片处理完成",
      chunkCount: chunks.length,
    });
    logger.info("knowledge job completed", { fileId, knowledgeId });

  } catch (error: any) {
    logger.error("knowledge job failed", {
      fileId,
      knowledgeId,
      error: logger.normalizeError(error),
    });
    await publishTaskEvent(fileId, {
      type: "knowledge:error",
      message: `处理失败: ${error.message || "未知错误"}`,
    });
    throw error;
  }
});

async function extractText(
  buffer: Buffer,
  mimeType: string | null,
  fileName: string
): Promise<string> {
  const isPdf = mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    try {
      if (typeof PDFParse !== "function") {
        throw new Error("PDFParse loader failed: not a function");
      }
      // pdf-parse v2 strictly requires Uint8Array and fails on Buffer
      const parser = new PDFParse(new Uint8Array(buffer));
      const data = await parser.getText();
      logger.info("knowledge pdf extracted", {
        fileName,
        textLength: data.text?.length || 0,
      });
      return (data.text || "").trim().replace(/\0/g, "");
    } catch (error: any) {
      logger.error("knowledge pdf parsing failed", {
        fileName,
        mimeType,
        error: logger.normalizeError(error),
      });
      throw new Error(`PDF 解析失败: ${error.message || "未知错误"}`);
    }
  }

  // Text-based files
  const isText =
    mimeType?.startsWith("text/") ||
    fileName.toLowerCase().endsWith(".md") ||
    fileName.toLowerCase().endsWith(".txt") ||
    fileName.toLowerCase().endsWith(".csv") ||
    fileName.toLowerCase().endsWith(".json");

  if (isText) {
    return buffer.toString("utf-8").trim().replace(/\0/g, "");
  }

  // Unknown binary file - attempt UTF-8 conversion anyway
  logger.warn("knowledge unknown mime type, fallback to UTF-8", {
    fileName,
    mimeType,
  });
  return buffer.toString("utf-8").trim().replace(/\0/g, "");
}

function splitTextIntoChunks(text: string, maxTokens: number): string[] {
  const result: string[] = [];
  const charLimit = Math.floor(maxTokens * 1.2);

  let remaining = text.trim();

  while (remaining.length > 0) {
    if (remaining.length <= charLimit) {
      result.push(remaining);
      break;
    }

    let splitIndex = -1;
    const separators = ["\n\n", "\n", "。", "！", "？", "；", ". ", "! ", "? ", "; ", " ", ""];

    for (const sep of separators) {
      if (sep === "") {
        splitIndex = charLimit;
        break;
      }
      const lastIdx = remaining.lastIndexOf(sep, charLimit);
      if (lastIdx !== -1 && lastIdx > 0) {
        splitIndex = lastIdx + sep.length;
        break;
      }
    }

    const chunk = remaining.slice(0, splitIndex).trim();
    if (chunk) {
      result.push(chunk);
    }
    remaining = remaining.slice(splitIndex).trim();
  }

  return result;
}


