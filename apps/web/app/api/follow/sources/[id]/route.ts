import prisma from "@/lib/prisma";
import { json, badRequest, notFound, serverError } from "@/app/api/_utils/http";
import { SourceUpdateSchema } from "@/app/api/_utils/zod";
import { Prisma } from "@/app/generated/prisma";
import { z } from "zod";

// 帮助函数：将 null 转换为 Prisma.JsonNull，undefined 保持不变
function jsonOrNull(value: unknown) {
  return value === null ? Prisma.JsonNull : value;
}

// 更新数据类型定义
type ConfigUpdateData = Record<string, unknown>;

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const item = await prisma.source.findUnique({
      where: { id },
      include: {
        web: true,
        darknet: { include: { proxy: true } },
        search: true,
        social: true,
        proxy: true,
        credential: true,
      },
    });
    if (!item) return notFound("Source not found");
    return json(item);
  } catch (e) {
    return serverError(e);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = SourceUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid source payload", {
        message: "Validation failed",
        details: z.flattenError(parsed.error),
      });
    }

    const exists = await prisma.source.findUnique({
      where: { id },
      include: {
        web: true,
        darknet: { include: { proxy: true } },
        search: true,
        social: true,
      },
    });
    if (!exists) return notFound("Source not found");

    const updated = await prisma.$transaction(async (tx) => {
      // 1) update base
      await tx.source.update({
        where: { id },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.description !== undefined
            ? { description: parsed.data.description }
            : {}),
          ...(parsed.data.active !== undefined
            ? { active: parsed.data.active }
            : {}),
          ...(parsed.data.rateLimit !== undefined
            ? { rateLimit: parsed.data.rateLimit }
            : {}),
          ...(parsed.data.proxyId !== undefined
            ? { proxyId: parsed.data.proxyId }
            : {}),
          ...(parsed.data.credentialId !== undefined
            ? { credentialId: parsed.data.credentialId }
            : {}),
        },
      });

      // 2) update per-type config (type 不允许变更)
      if (exists.type === "WEB" && parsed.data.web) {
        const webData = parsed.data.web;
        const updateData: ConfigUpdateData = {};
        if (webData.url !== undefined) updateData.url = webData.url;
        if (webData.headers !== undefined)
          updateData.headers = jsonOrNull(webData.headers);
        if (webData.crawlerEngine !== undefined)
          updateData.crawlerEngine = webData.crawlerEngine;
        if (webData.render !== undefined) updateData.render = webData.render;
        if (webData.parseRules !== undefined)
          updateData.parseRules = jsonOrNull(webData.parseRules);
        if (webData.robotsRespect !== undefined)
          updateData.robotsRespect = webData.robotsRespect;
        if (webData.proxyId !== undefined) updateData.proxyId = webData.proxyId;

        await tx.webSourceConfig.update({
          where: { sourceId: id },
          data: updateData,
        });
      }
      if (exists.type === "DARKNET" && parsed.data.darknet) {
        const darknetData = parsed.data.darknet;
        // 确保 proxyId 不被清空
        if (darknetData.proxyId === null) {
          return badRequest("DARKNET.proxyId is required", {
            message: "Validation failed",
            details: "Proxy ID is required for DARKNET source type.",
          });
        }

        const updateData: ConfigUpdateData = {};
        if (darknetData.url !== undefined) updateData.url = darknetData.url;
        if (darknetData.headers !== undefined)
          updateData.headers = jsonOrNull(darknetData.headers);
        if (darknetData.crawlerEngine !== undefined)
          updateData.crawlerEngine = darknetData.crawlerEngine;
        if (darknetData.proxyId !== undefined)
          updateData.proxyId = darknetData.proxyId;
        if (darknetData.render !== undefined)
          updateData.render = darknetData.render;
        if (darknetData.parseRules !== undefined)
          updateData.parseRules = jsonOrNull(darknetData.parseRules);

        await tx.darknetSourceConfig.update({
          where: { sourceId: id },
          data: updateData,
        });
      }
      if (exists.type === "SEARCH_ENGINE" && parsed.data.search) {
        const searchData = parsed.data.search;
        const updateData: ConfigUpdateData = {};
        if (searchData.engine !== undefined)
          updateData.engine = searchData.engine;
        if (searchData.query !== undefined) updateData.query = searchData.query;
        if (searchData.region !== undefined)
          updateData.region = searchData.region;
        if (searchData.lang !== undefined) updateData.lang = searchData.lang;
        if (searchData.apiEndpoint !== undefined)
          updateData.apiEndpoint = searchData.apiEndpoint;
        if (searchData.options !== undefined)
          updateData.options = jsonOrNull(searchData.options);
        if (searchData.credentialId !== undefined)
          updateData.credentialId = searchData.credentialId;

        await tx.searchEngineSourceConfig.update({
          where: { sourceId: id },
          data: updateData,
        });
      }
      if (exists.type === "SOCIAL_MEDIA" && parsed.data.social) {
        const socialData = parsed.data.social;
        const updateData: ConfigUpdateData = {};
        if (socialData.platform !== undefined)
          updateData.platform = socialData.platform;
        if (socialData.config !== undefined)
          updateData.config = socialData.config;
        if (socialData.credentialId !== undefined)
          updateData.credentialId = socialData.credentialId;
        if (socialData.proxyId !== undefined)
          updateData.proxyId = socialData.proxyId;

        await tx.socialMediaSourceConfig.update({
          where: { sourceId: id },
          data: updateData,
        });
      }

      return tx.source.findUnique({
        where: { id },
        include: {
          web: true,
          darknet: { include: { proxy: true } },
          search: true,
          social: true,
          proxy: true,
          credential: true,
        },
      });
    });

    return json(updated);
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const exists = await prisma.source.findUnique({ where: { id } });
    if (!exists) return notFound("Source not found");

    // 先删 config 再删 source（若未设级联）
    await prisma.$transaction(async (tx) => {
      await tx.webSourceConfig.deleteMany({ where: { sourceId: id } });
      await tx.darknetSourceConfig.deleteMany({ where: { sourceId: id } });
      await tx.searchEngineSourceConfig.deleteMany({ where: { sourceId: id } });
      await tx.socialMediaSourceConfig.deleteMany({ where: { sourceId: id } });
      await tx.source.delete({ where: { id } });
    });
    return json({ ok: true });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2025"
    ) {
      return notFound("Source not found");
    }
    return serverError(e);
  }
}
