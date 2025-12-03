import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { json, badRequest, serverError, conflict } from "@/app/api/_utils/http";

const FavoriteActionSchema = z.object({
  contentId: z.string().min(1),
});

// TODO: 从认证系统获取 userId，目前使用临时方案
function getUserId(): string {
  // 临时方案：从环境变量或请求头获取
  // 实际应该从 session/cookie/token 中获取
  return process.env.DEFAULT_USER_ID || "default-user-id";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = FavoriteActionSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("Invalid payload", parsed.error.flatten());
    }

    const { contentId } = parsed.data;
    const userId = getUserId();

    // 检查内容是否存在
    const content = await prisma.content.findUnique({
      where: { id: contentId },
    });

    if (!content) {
      return json({ error: "Content not found" }, 404);
    }

    // 检查是否已经收藏
    const existing = await prisma.favorite.findUnique({
      where: {
        userId_contentId: {
          userId,
          contentId,
        },
      },
    });

    if (existing) {
      return conflict("Already favorited");
    }

    // 创建收藏
    const favorite = await prisma.favorite.create({
      data: {
        userId,
        contentId,
      },
      include: {
        content: true,
      },
    });

    return json({
      success: true,
      data: {
        id: favorite.id,
        contentId: favorite.contentId,
        createdAt: favorite.createdAt.toISOString(),
      },
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const contentId = url.searchParams.get("contentId");

    if (!contentId) {
      return badRequest("contentId is required");
    }

    const userId = getUserId();

    // 删除收藏
    const deleted = await prisma.favorite.deleteMany({
      where: {
        userId,
        contentId,
      },
    });

    if (deleted.count === 0) {
      return json({ error: "Favorite not found" }, 404);
    }

    return json({
      success: true,
      data: { deleted: true },
    });
  } catch (error) {
    return serverError(error);
  }
}

