import prisma from "@/lib/prisma";
import { json, badRequest, serverError, conflict } from "@/app/api/_utils/http";
import { SourceCreateSchema, SourceQuerySchema } from "@/app/api/_utils/zod";
import { Prisma, SocialPlatform } from "@/app/generated/prisma";
import { syncSocialPresetBinding } from "@/lib/source-preset-binding";
import { z } from "zod";

// 帮助函数：将 null 转换为 Prisma.JsonNull，undefined 保持不变
function jsonOrNull(value: unknown) {
  return value === null ? Prisma.JsonNull : value;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const includeRelations = searchParams.get("includeRelations") === "true";
    const parsed = SourceQuerySchema.safeParse(
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

    const include = includeRelations
      ? {
        web: true,
        darknet: { include: { proxy: true } },
        search: true,
        social: true,
        presetBindings: {
          include: {
            preset: {
              select: {
                id: true,
                key: true,
                version: true,
                name: true,
                platform: true,
                scriptRelPath: true,
                status: true,
                isActive: true,
              },
            },
          },
          orderBy: { updatedAt: "desc" as const },
        },
        proxy: true,
        credential: true,
      }
      : undefined;

    const [total, items] = await Promise.all([
      prisma.source.count({ where }),
      prisma.source.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include,
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
    const parsed = SourceCreateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid source payload", {
        message: "Validation failed",
        details: z.flattenError(parsed.error),
      });
    }

    const data = parsed.data;

    const existingSource = await prisma.source.findUnique({
      where: { name: data.name },
    });
    if (existingSource) return conflict("Source already exists");

    const created = await prisma.$transaction(async (tx) => {
      const base = await tx.source.create({
        data: {
          name: data.name,
          description: data.description ?? null,
          type: data.type,
          active: data.active ?? true,
          rateLimit: data.rateLimit ?? null,
          proxyId: data.proxyId ?? null,
          credentialId: data.credentialId ?? null,
        },
      });

      switch (data.type) {
        case "WEB":
          await tx.webSourceConfig.create({
            data: {
              sourceId: base.id,
              url: data.web.url,
              headers: jsonOrNull(data.web.headers),
              crawlerEngine: data.web.crawlerEngine ?? "FETCH",
              render: data.web.render ?? false,
              parseRules: jsonOrNull(data.web.parseRules),
              robotsRespect: data.web.robotsRespect ?? true,
              proxyId: data.web.proxyId ?? null,
            },
          });
          break;
        case "DARKNET":
          await tx.darknetSourceConfig.create({
            data: {
              sourceId: base.id,
              url: data.darknet.url,
              headers: jsonOrNull(data.darknet.headers),
              crawlerEngine: data.darknet.crawlerEngine ?? "FETCH",
              proxyId: data.darknet.proxyId,
              render: data.darknet.render ?? false,
              parseRules: jsonOrNull(data.darknet.parseRules),
            },
          });
          break;
        case "SEARCH_ENGINE":
          await tx.searchEngineSourceConfig.create({
            data: {
              sourceId: base.id,
              engine: data.search.engine,
              query: data.search.query,
              region: data.search.region ?? null,
              lang: data.search.lang ?? "auto",
              apiEndpoint: data.search.apiEndpoint ?? null,
              options: jsonOrNull(data.search.options),
              credentialId: data.search.credentialId ?? null,
            },
          });
          break;
        case "SOCIAL_MEDIA":
          await tx.socialMediaSourceConfig.create({
            data: {
              sourceId: base.id,
              platform: data.social.platform as SocialPlatform,
              config: data.social.config,
              credentialId: data.social.credentialId ?? null,
              proxyId: data.social.proxyId ?? null,
            },
          });
          await syncSocialPresetBinding(tx, {
            sourceId: base.id,
            config: data.social.config,
          });
          break;
      }

      return tx.source.findUnique({
        where: { id: base.id },
        include: {
          web: true,
          darknet: { include: { proxy: true } },
          search: true,
          social: true,
          presetBindings: {
            include: {
              preset: {
                select: {
                  id: true,
                  key: true,
                  version: true,
                  name: true,
                  platform: true,
                  scriptRelPath: true,
                  status: true,
                  isActive: true,
                },
              },
            },
            orderBy: { updatedAt: "desc" as const },
          },
          proxy: true,
          credential: true,
        },
      });
    });

    return json(created, 201);
  } catch (error) {
    console.error("[sources] POST error:", error);
    return serverError(error);
  }
}
