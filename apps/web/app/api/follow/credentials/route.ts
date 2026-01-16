import { json, badRequest, serverError } from "@/app/api/_utils/http";
import prisma from "@/lib/prisma";

/**
 * GET /api/follow/credentials
 * 
 * List all credentials, optionally filtered by kind (platform).
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const kind = searchParams.get("kind"); // e.g., "x-cookie", "xiaohongshu-cookie"
    const platform = searchParams.get("platform"); // e.g., "x", "xiaohongshu"

    const where: Record<string, unknown> = {};

    if (kind) {
      where.kind = kind;
    } else if (platform) {
      // Convert platform to kind format
      where.kind = `${platform.toLowerCase()}-cookie`;
    }

    const credentials = await prisma.credential.findMany({
      where,
      select: {
        id: true,
        name: true,
        kind: true,
        createdAt: true,
        updatedAt: true,
        // Don't select 'data' to avoid exposing sensitive cookie data
      },
      orderBy: { updatedAt: "desc" },
    });

    return json({ credentials });

  } catch (error) {
    console.error("[credentials] Error:", error);
    return serverError(error);
  }
}
