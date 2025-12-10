import { createKnowledgeWorker, publishTaskEvent } from "@/lib/queue";
import prisma from "@/lib/prisma";
import { downloadFile } from "@/lib/storage";
import { createEmbeddings } from "@oak/agents/embeddings";

export const knowledgeWorker = createKnowledgeWorker(async (job) => {
  const { knowledgeId, fileId, storageKey, vectorModel, chunkSize } = job.data;

  console.log(
    `[knowledge-worker] start job fileId=${fileId} knowledgeId=${knowledgeId}`
  );

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

  console.log(
    `[knowledge-worker] file ${fileId} downloaded size=${knowledgeFile.size}`
  );

  const buffer = await downloadFile(storageKey);
  const text = extractText(buffer, knowledgeFile.mimeType, knowledgeFile.name);

  const chunks = splitTextIntoChunks(text, chunkSize);
  if (!chunks.length) {
    throw new Error("无法从文档中提取文本内容");
  }

  await publishTaskEvent(fileId, {
    type: "knowledge:chunk",
    message: `生成 ${chunks.length} 个切片`,
  });
  console.log(
    `[knowledge-worker] created ${chunks.length} chunks for fileId=${fileId}`
  );

  const embeddings = await createEmbeddings(chunks, vectorModel);

  await prisma.$transaction(
    chunks.map((content, index) =>
      prisma.knowledgeChunk.create({
        data: {
          knowledgeId,
          fileId,
          content,
          metadata: {
            fileName: knowledgeFile.name,
            fileId,
            chunkIndex: index,
            chunkSize,
            knowledgeName: knowledgeFile.knowledge?.name,
          },
          embedding: vectorToBuffer(embeddings[index]),
          chunkIndex: index,
        },
      })
    )
  );

  await prisma.knowledge.update({
    where: { id: knowledgeId },
    data: { updatedAt: new Date() },
  });

  await publishTaskEvent(fileId, {
    type: "knowledge:done",
    message: "知识库切片处理完成",
    chunkCount: chunks.length,
  });
  console.log(
    `[knowledge-worker] job done for fileId=${fileId} chunkCount=${chunks.length}`
  );
});

function extractText(
  buffer: Buffer,
  mimeType: string | null,
  fileName: string
): string {
  const text = buffer.toString("utf-8").trim();
  if (mimeType?.startsWith("text/")) {
    return text;
  }
  if (fileName.toLowerCase().endsWith(".md")) {
    return text;
  }
  if (fileName.toLowerCase().endsWith(".txt")) {
    return text;
  }
  // Fallback: treat bytes as utf-8 string even for binary files
  return text;
}

function splitTextIntoChunks(text: string, maxTokens: number): string[] {
  const tokens = text.split(/\s+/).filter((token) => token.length > 0);
  const result: string[] = [];
  let currentChunk: string[] = [];
  let currentCount = 0;

  for (const token of tokens) {
    if (currentCount >= maxTokens && currentChunk.length > 0) {
      result.push(currentChunk.join(" "));
      currentChunk = [];
      currentCount = 0;
    }
    currentChunk.push(token);
    currentCount += 1;
  }

  if (currentChunk.length > 0) {
    result.push(currentChunk.join(" "));
  }

  return result;
}

function vectorToBuffer(vector: number[]): Uint8Array<ArrayBuffer> {
  const float32 = Float32Array.from(vector);
  const arrayBuffer = new ArrayBuffer(float32.byteLength);
  new Float32Array(arrayBuffer).set(float32);
  const bytes = new Uint8Array(arrayBuffer);
  return bytes as Uint8Array<ArrayBuffer>;
}
