import { NextRequest } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma";
import { json, badRequest, serverError } from "@/app/api/_utils/http";
import { createEmbedding } from "@oak/agents/embeddings";

const RetrieveSchema = z.object({
  query: z.string().min(1).max(500),
  knowledgeIds: z.array(z.string().cuid()).optional(),
  topK: z.coerce.number().int().min(1).max(20).default(10),
  minSimilarity: z.coerce.number().min(0).max(1).default(0.75).optional(),
});

// TODO: 从认证系统获取 userId，目前使用临时方案
function getUserId(): string {
  return process.env.DEFAULT_USER_ID || "default-user-id";
}

/**
 * RAG 检索接口
 * 根据查询文本从知识库中检索相关片段
 *
 * 注意：这是一个简化实现，实际应该：
 * 1. 调用 embeddings API 将 query 转为向量
 * 2. 使用 pgvector 进行相似度检索
 * 3. 返回 Top-K 相关片段
 *
 * 当前实现使用文本相似度作为临时方案
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = RetrieveSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("Invalid payload", parsed.error.flatten());
    }

    const { query, knowledgeIds, topK, minSimilarity } = parsed.data;
    const userId = getUserId();

    // 构建查询条件
    const where: Prisma.KnowledgeChunkWhereInput = {
      knowledge: {
        ownerId: userId,
      },
    };

    // 如果指定了知识库ID，则只检索这些知识库
    if (knowledgeIds && knowledgeIds.length > 0) {
      where.knowledgeId = { in: knowledgeIds };
    }

    const queryEmbedding = await createEmbedding(query);
    // 将向量数组转换为 pgvector 特定的字符串格式 [0.1, 0.2, ...]
    const vectorString = `[${queryEmbedding.join(",")}]`;

    const knowledgeFilter =
      knowledgeIds && knowledgeIds.length > 0
        ? Prisma.sql`AND kc."knowledgeId" = ANY(${knowledgeIds})`
        : Prisma.empty;

    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        content: string;
        metadata: Prisma.JsonValue | null;
        similarity: number;
        knowledgeId: string;
        knowledgeName: string;
        knowledgeDescription: string | null;
      }>
    >(
      Prisma.sql`
        SELECT
          kc.id,
          kc.content,
          kc.metadata,
          kc."knowledgeId",
          k.name AS "knowledgeName",
          k.description AS "knowledgeDescription",
          kc.embedding::vector <=> ${vectorString}::vector AS similarity
        FROM "KnowledgeChunk" kc
        JOIN "Knowledge" k ON kc."knowledgeId" = k."id"
        WHERE k."ownerId" = ${userId}
        ${knowledgeFilter}
        ORDER BY similarity ASC
        LIMIT ${topK}
      `
    );

    const similarityThreshold = minSimilarity ?? 0.75;
    const scoredChunks = rows
      .map((row) => ({
        row,
        normalizedScore: Math.max(0, 1 - row.similarity),
      }))
      .filter(({ normalizedScore }) => normalizedScore >= similarityThreshold)
      .sort((a, b) => b.normalizedScore - a.normalizedScore);

    const results = scoredChunks.map(({ row, normalizedScore }) => {
      const chunkMetadata = row.metadata as
        | Record<string, string | number | boolean | null>
        | null
        | undefined;

      return {
        id: row.id,
        content: row.content,
        similarity: normalizedScore,
        metadata: {
          knowledgeId: row.knowledgeId,
          knowledgeName: row.knowledgeName,
          knowledgeDescription: row.knowledgeDescription,
          ...(chunkMetadata || {}),
        },
      };
    });

    return json({
      success: true,
      data: {
        query,
        results,
        count: results.length,
      },
    });
  } catch (error) {
    return serverError(error);
  }
}
