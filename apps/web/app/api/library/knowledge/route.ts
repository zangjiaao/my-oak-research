import { NextRequest } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { json, badRequest, serverError, notFound } from "@/app/api/_utils/http";
import type { Prisma } from "@/app/generated/prisma";

const KnowledgeQuerySchema = z.object({
  search: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const CreateKnowledgeSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
});

const UpdateKnowledgeSchema = CreateKnowledgeSchema.partial();

// TODO: 从认证系统获取 userId，目前使用临时方案
function getUserId(): string {
  return process.env.DEFAULT_USER_ID || "default-user-id";
}

const mapKnowledge = (item: {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  files: Array<{ id: string }>;
  knowledgeChunks: Array<{ id: string }>;
}) => ({
  id: item.id,
  name: item.name,
  description: item.description,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  fileCount: item.files.length,
  chunkCount: item.knowledgeChunks.length,
});

type KnowledgeResponse = {
  items: ReturnType<typeof mapKnowledge>[];
  nextCursor: string | null;
};

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const parsed = KnowledgeQuerySchema.safeParse(
      Object.fromEntries(url.searchParams.entries())
    );

    if (!parsed.success) {
      return badRequest("Invalid query parameters", parsed.error.flatten());
    }

    const { search, cursor, limit } = parsed.data;
    const userId = getUserId();

    const where: Prisma.KnowledgeWhereInput = {
      ownerId: userId,
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const knowledges = await prisma.knowledge.findMany({
      where,
      include: {
        files: {
          select: { id: true },
        },
        knowledgeChunks: {
          select: { id: true },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
    });

    const hasMore = knowledges.length > limit;
    const nextCursor = hasMore ? knowledges[limit].id : null;
    const items = (hasMore ? knowledges.slice(0, limit) : knowledges).map(
      mapKnowledge
    );

    const response: KnowledgeResponse = {
      items,
      nextCursor,
    };

    return json(response);
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = CreateKnowledgeSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("Invalid payload", parsed.error.flatten());
    }

    const { name, description } = parsed.data;
    const userId = getUserId();

    // 检查名称是否已存在
    const existing = await prisma.knowledge.findFirst({
      where: {
        name,
        ownerId: userId,
      },
    });

    if (existing) {
      return json({ error: "Knowledge with this name already exists" }, 409);
    }

    const knowledge = await prisma.knowledge.create({
      data: {
        name,
        description: description || null,
        ownerId: userId,
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
      data: mapKnowledge(knowledge),
    });
  } catch (error) {
    return serverError(error);
  }
}
