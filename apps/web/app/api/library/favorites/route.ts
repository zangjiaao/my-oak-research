import { NextRequest } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { json, badRequest, serverError } from "@/app/api/_utils/http";
import type { Prisma } from "@/app/generated/prisma";

const FavoritesQuerySchema = z.object({
  platform: z.string().optional(),
  search: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// TODO: 从认证系统获取 userId，目前使用临时方案
function getUserId(req: NextRequest): string {
  const headerId = req.headers.get("x-user-id");
  if (headerId) return headerId;
  return process.env.DEFAULT_USER_ID || "default-user-id";
}

const mapFavoriteContent = (item: {
  id: string;
  contentId: string;
  createdAt: Date;
  content: {
    id: string;
    title: string;
    summary: string;
    markdown: string;
    platform: string;
    type: string;
    time: Date;
    url: string | null;
    image: string | null;
  };
}) => ({
  id: item.content.id,
  title: item.content.title,
  summary: item.content.summary,
  markdown: item.content.markdown,
  platform: item.content.platform,
  time: item.content.time.toISOString(),
  url: item.content.url,
  image: item.content.image,
  type: item.content.type,
  favoriteId: item.id,
  favoritedAt: item.createdAt.toISOString(),
});

type FavoriteResponse = {
  items: ReturnType<typeof mapFavoriteContent>[];
  nextCursor: string | null;
};

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const parsed = FavoritesQuerySchema.safeParse(
      Object.fromEntries(url.searchParams.entries())
    );

    if (!parsed.success) {
      return badRequest("Invalid query parameters", parsed.error.flatten());
    }

    const { platform, search, from, to, cursor, limit } = parsed.data;
    const userId = getUserId(request);

    const where: Prisma.FavoriteWhereInput = {
      userId,
    };

    if (platform || search || from || to) {
      where.content = {};

      if (platform) {
        where.content.platform = platform;
      }

      if (search) {
        where.content.OR = [
          { title: { contains: search, mode: "insensitive" } },
          { summary: { contains: search, mode: "insensitive" } },
        ];
      }

      if (from || to) {
        where.content.time = {};
        if (from) {
          where.content.time.gte = new Date(from);
        }
        if (to) {
          where.content.time.lte = new Date(to);
        }
      }
    }

    const favorites = await prisma.favorite.findMany({
      where,
      include: {
        content: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
    });

    const hasMore = favorites.length > limit;
    const nextCursor = hasMore ? favorites[limit].id : null;
    const items = (hasMore ? favorites.slice(0, limit) : favorites).map(
      mapFavoriteContent
    );

    const response: FavoriteResponse = {
      items,
      nextCursor,
    };

    return json(response);
  } catch (error) {
    return serverError(error);
  }
}
