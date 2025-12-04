import { NextRequest } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma";
import { json, badRequest, serverError } from "@/app/api/_utils/http";

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

    // 获取所有相关的切片
    // TODO: 这里应该使用向量相似度检索，当前使用文本匹配作为临时方案
    const chunks = await prisma.knowledgeChunk.findMany({
      where,
      include: {
        knowledge: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
      take: topK * 3, // 获取更多候选，后续可以按相似度排序
    });

    // TODO: 实际应该：
    // 1. 调用 embeddings API 将 query 转为向量
    // 2. 计算每个 chunk 的 embedding 与 query embedding 的余弦相似度
    // 3. 按相似度排序，过滤掉低于 minSimilarity 的
    // 4. 返回 Top-K

    // 临时方案：简单的文本匹配评分
    const scoredChunks = chunks
      .map((chunk) => {
        const content = chunk.content.toLowerCase();
        const queryLower = query.toLowerCase();
        const queryWords = queryLower.split(/\s+/);

        // 简单的关键词匹配评分
        let score = 0;
        queryWords.forEach((word) => {
          if (content.includes(word)) {
            score += 1;
          }
        });

        // 归一化到 0-1
        const normalizedScore = Math.min(score / queryWords.length, 1);

        return {
          ...chunk,
          similarity: normalizedScore,
        };
      })
      .filter((chunk) => chunk.similarity >= (minSimilarity || 0.75))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    const results = scoredChunks.map((chunk) => {
      // 类型安全的 metadata 处理
      const chunkMetadata = chunk.metadata as
        | Record<string, string | number | boolean | null>
        | null
        | undefined;

      return {
        id: chunk.id,
        content: chunk.content,
        similarity: chunk.similarity,
        metadata: {
          knowledgeId: chunk.knowledgeId,
          knowledgeName: chunk.knowledge.name,
          knowledgeDescription: chunk.knowledge.description,
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
