import prisma from "@/lib/prisma";
import { json, badRequest, serverError, conflict } from "@/app/api/_utils/http";
import { SourceCreateSchema, SourceQuerySchema } from "@/app/api/_utils/zod";
import { Prisma } from "@/app/generated/prisma";
import { syncSocialPresetBinding } from "@/lib/source-preset-binding";
import { z } from "zod";

// 帮助函数：将 null 转换为 Prisma.JsonNull，undefined 保持不变
function jsonOrNull(value: unknown) {
  return value === null ? Prisma.JsonNull : value;
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  if (value === null) return null as unknown as Prisma.InputJsonValue;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toPrismaJsonValue(item));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).flatMap(([key, item]) =>
      item === undefined ? [] : [[key, toPrismaJsonValue(item)]]
    );
    return Object.fromEntries(entries) as Prisma.InputJsonObject;
  }
  return String(value);
}

function toPrismaJsonObject(value: unknown): Prisma.InputJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return toPrismaJsonValue(value) as Prisma.InputJsonObject;
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

    const { q, category, isDarknet, active, page, pageSize } = parsed.data;
    const where: Record<string, unknown> = {};
    if (q) where.name = { contains: q, mode: "insensitive" };
    if (category) where.category = category;
    if (isDarknet) where.isDarknet = isDarknet === "true";
    if (active) where.active = active === "true";

    const include = includeRelations
      ? {
        web: true,
        darknet: { include: { proxy: true } },
        search: true,
        social: true,
        identity: true,
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
          category: data.category,
          isDarknet: data.isDarknet ?? false,
          active: data.active ?? true,
          rateLimit: data.rateLimit ?? null,
          proxyId: data.proxyId ?? null,
          credentialId: data.credentialId ?? null,
        },
      });

      switch (data.category) {
        case "STREAM":
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
        case "RETRIEVAL":
          if (data.isDarknet) {
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
          }
          await tx.searchEngineSourceConfig.create({
            data: {
              sourceId: base.id,
              platform: data.search.platform,
              engine: data.search.engine,
              objective: data.search.objective ?? "",
              apiEndpoint: data.search.apiEndpoint ?? null,
              options: jsonOrNull(data.search.options),
              credentialId: data.search.credentialId ?? null,
              keywordStrategy: data.search.keywordStrategy ?? "AUTO",
            },
          });
          break;
        case "INTERACTIVE":
          await tx.socialMediaSourceConfig.create({
            data: {
              sourceId: base.id,
              platform: data.social.platform,
              config: toPrismaJsonObject(data.social.config),
              credentialId: data.social.credentialId ?? null,
              proxyId: data.social.proxyId ?? null,
              keywordStrategy: data.social.keywordStrategy ?? "AUTO",
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
          identity: true,
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
