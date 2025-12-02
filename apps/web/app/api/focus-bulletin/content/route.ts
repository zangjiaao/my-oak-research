import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import type { Prisma, Content } from "@/app/generated/prisma";

const contentTypeSchema = z.enum(["Web", "Client", "Darknet"]);
const ContentQuerySchema = z.object({
  platform: z.string().trim().min(1).optional(),
  type: contentTypeSchema.optional(),
  search: z.string().trim().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const mapContent = (item: Content & { image?: string | null }) => ({
  id: item.id,
  title: item.title,
  summary: item.summary,
  markdown: item.markdown,
  platform: item.platform,
  time: item.time.toISOString(),
  url: item.url,
  image: item.image ?? null, // 封面图（可选），null 或 undefined 时返回 null
  type: item.type,
});

type ContentResponse = {
  items: ReturnType<typeof mapContent>[];
  nextCursor: string | null;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = ContentQuerySchema.safeParse(
    Object.fromEntries(url.searchParams.entries())
  );

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid query parameters",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const {
    platform,
    type: contentType,
    search,
    from,
    to,
    cursor,
    limit,
  } = parsed.data;

  const where: Prisma.ContentWhereInput = {};

  if (platform) {
    where.platform = platform;
  }

  if (contentType) {
    where.type = contentType;
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { summary: { contains: search, mode: "insensitive" } },
    ];
  }

  if (from || to) {
    where.time = {};
    if (from) {
      where.time.gte = new Date(from);
    }
    if (to) {
      where.time.lte = new Date(to);
    }
  }

  const contents = await prisma.content.findMany({
    where,
    orderBy: {
      time: "desc",
    },
    take: limit + 1,
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
  });

  const hasMore = contents.length > limit;
  const nextCursor = hasMore ? contents[limit].id : null;
  const items = (hasMore ? contents.slice(0, limit) : contents).map((item) =>
    mapContent(item)
  );

  const response: ContentResponse = {
    items,
    nextCursor,
  };

  return NextResponse.json(response);
}
