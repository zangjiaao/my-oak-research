import prisma from "@/lib/prisma";
import { json, badRequest, serverError, conflict } from "@/app/api/_utils/http";
import { ProxyCreateSchema, ProxyQuerySchema } from "@/app/api/_utils/zod";
import { z } from "zod";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = ProxyQuerySchema.safeParse(
      Object.fromEntries(searchParams)
    );
    if (!parsed.success) {
      return badRequest("Invalid query parameters", {
        message: "Query validation failed",
        details: z.flattenError(parsed.error),
      });
    }

    const { q, type, active, page, pageSize } = parsed.data;
    const where: Record<string, unknown> = {};
    if (q) where.name = { contains: q, mode: "insensitive" };
    if (type) where.type = type;
    if (active) where.active = active === "true";

    const [total, items] = await Promise.all([
      prisma.proxy.count({ where }),
      prisma.proxy.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: {
            select: {
              sources: true,
              darknetOverrides: true,
              webOverrides: true,
              socialOverrides: true,
            },
          },
        },
      }),
    ]);

    return json({ total, page, pageSize, items });
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = ProxyCreateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid proxy payload", {
        message: "Validation failed",
        details: z.flattenError(parsed.error),
      });
    }

    const data = parsed.data;

    // 检查名称唯一性
    const existingProxy = await prisma.proxy.findFirst({
      where: {
        name: data.name,
      },
    });
    if (existingProxy) return conflict("Proxy name already exists");

    // 检查 URL 唯一性（可选，根据业务需求）
    const existingUrl = await prisma.proxy.findFirst({
      where: {
        url: data.url,
      },
    });
    if (existingUrl) return conflict("Proxy URL already exists");

    const created = await prisma.proxy.create({
      data: {
        name: data.name,
        type: data.type,
        url: data.url,
        active: data.active ?? true,
      },
      include: {
        _count: {
          select: {
            sources: true,
            darknetOverrides: true,
            webOverrides: true,
            socialOverrides: true,
          },
        },
      },
    });

    return json(created, 201);
  } catch (error) {
    return serverError(error);
  }
}
