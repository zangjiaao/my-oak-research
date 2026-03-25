import { z } from "zod";

import { json, badRequest, serverError } from "@/app/api/_utils/http";
import { Prisma, SearchPlatform } from "@/app/generated/prisma";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  loadBatchTemplates,
  buildIdentity,
  buildSourceCreateData,
  identityKey,
  isUniqueViolation,
  listMissingRequirements,
  sourceIdentityFromSource,
} from "@/lib/source-batch";

const BatchCreateItemSchema = z.object({
  key: z.string().trim().min(1),
  enabled: z.boolean().default(true),
  config: z.record(z.string(), z.unknown()).default({}),
  credentialRefs: z.record(z.string(), z.string().nullable()).optional(),
});

const BatchCreateSchema = z.object({
  items: z.array(BatchCreateItemSchema).min(1),
  defaults: z
    .object({
      active: z.boolean().optional(),
    })
    .optional(),
});

const SEARCH_PLATFORM_VALUES = Object.values(SearchPlatform) as string[];

function reserveUniqueName(baseName: string, usedNames: Set<string>): string {
  const normalizedBase = baseName.trim() || "Untitled Source";
  if (!usedNames.has(normalizedBase)) {
    usedNames.add(normalizedBase);
    return normalizedBase;
  }

  let index = 2;
  let candidate = `${normalizedBase} #${index}`;
  while (usedNames.has(candidate)) {
    index += 1;
    candidate = `${normalizedBase} #${index}`;
  }
  usedNames.add(candidate);
  return candidate;
}

function normalizeSearchPlatform(
  value: unknown,
  driver: unknown
): SearchPlatform {
  const normalizedDriver = String(driver ?? "").trim().toLowerCase();
  if (normalizedDriver !== "http") {
    return SearchPlatform.CUSTOM;
  }
  const normalized = String(value ?? "").trim().toUpperCase();
  if (SEARCH_PLATFORM_VALUES.includes(normalized)) {
    return normalized as SearchPlatform;
  }
  return SearchPlatform.CUSTOM;
}

export async function POST(req: Request) {
  let parsedBody: z.infer<typeof BatchCreateSchema> | null = null;
  const skipped: Array<{ key: string; reason: "EXISTS" | "UNSELECTED" }> = [];

  try {
    const body = await req.json();
    const parsed = BatchCreateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid batch create payload", {
        details: z.flattenError(parsed.error),
      });
    }
    parsedBody = parsed.data;
    const templateMap = new Map(
      (await loadBatchTemplates()).map((item) => [item.key, item])
    );

    const credentialRows = await prisma.credential.findMany({
      select: { id: true, kind: true },
    });
    const credentialCounts = credentialRows.reduce<Record<string, number>>(
      (acc: Record<string, number>, row: { kind: string }) => {
        acc[row.kind] = (acc[row.kind] ?? 0) + 1;
        return acc;
      },
      {}
    );

    const invalid: Array<{ key: string; missingFields: string[]; message: string }> = [];
    const enabledItems: Array<z.infer<typeof BatchCreateItemSchema>> = [];

    for (const item of parsed.data.items) {
      if (!item.enabled) {
        skipped.push({ key: item.key, reason: "UNSELECTED" });
        continue;
      }

      const template = templateMap.get(item.key);
      if (!template) {
        invalid.push({
          key: item.key,
          missingFields: ["key"],
          message: "Unknown template key",
        });
        continue;
      }

      const missingFields = listMissingRequirements(
        template,
        item.config,
        item.credentialRefs,
        credentialCounts
      );
      if (missingFields.length > 0) {
        invalid.push({
          key: item.key,
          missingFields,
          message: "Selected item is missing required fields or credentials",
        });
        continue;
      }

      enabledItems.push(item);
    }

    if (invalid.length > 0) {
      return json({
        created: [],
        skipped,
        invalid,
        failed: [],
      });
    }

    const [identityRows, sources] = await Promise.all([
      prisma.sourceIdentity.findMany({
        select: {
          category: true,
          isDarknet: true,
          platform: true,
          driver: true,
          intentType: true,
          intentArgsHash: true,
        },
      }),
      prisma.source.findMany({
        select: {
          name: true,
          category: true,
          isDarknet: true,
          web: { select: { sourceId: true } },
          darknet: { select: { sourceId: true } },
          search: { select: { sourceId: true, platform: true, objective: true, options: true } },
          social: { select: { sourceId: true, platform: true, config: true } },
        },
      }),
    ]);

    const existingIdentityKeys = new Set(identityRows.map((row) => identityKey(row)));
    for (const source of sources) {
      const fallbackIdentity = sourceIdentityFromSource(source);
      if (!fallbackIdentity) continue;
      existingIdentityKeys.add(identityKey(fallbackIdentity));
    }
    const usedSourceNames = new Set(
      sources.map((source) => source.name.trim()).filter(Boolean)
    );

    const creationQueue: Array<{
      key: string;
      identity: ReturnType<typeof buildIdentity>;
      item: z.infer<typeof BatchCreateItemSchema>;
      createData: Record<string, unknown>;
    }> = [];

    for (const item of enabledItems) {
      const template = templateMap.get(item.key);
      if (!template) continue;

      const identity = buildIdentity(template, item.config);
      const key = identityKey(identity);
      if (existingIdentityKeys.has(key)) {
        skipped.push({ key: item.key, reason: "EXISTS" });
        continue;
      }
      existingIdentityKeys.add(key);
      const createData = buildSourceCreateData({
        template,
        config: item.config,
        defaults: parsed.data.defaults,
        credentialRefs: item.credentialRefs,
        identity,
      }) as Record<string, unknown>;
      createData.name = reserveUniqueName(String(createData.name ?? ""), usedSourceNames);

      creationQueue.push({ key: item.key, identity, item, createData });
    }

    const created: Array<{ key: string; sourceId: string; name: string }> = [];
    const failed: Array<{ key: string; error: string }> = [];

    await prisma.$transaction(async (tx) => {
      for (const task of creationQueue) {
        const template = templateMap.get(task.key);
        if (!template) continue;
        const createData = task.createData;
        try {
          const base = await tx.source.create({
            data: {
              name: String(createData.name),
              description:
                typeof createData.description === "string"
                  ? createData.description
                  : null,
              category: template.category,
              isDarknet: template.isDarknet,
              active: Boolean(createData.active),
              rateLimit:
                typeof createData.rateLimit === "number" ? createData.rateLimit : null,
              proxyId:
                typeof createData.proxyId === "string" ? createData.proxyId : null,
              credentialId:
                typeof createData.credentialId === "string"
                  ? createData.credentialId
                  : null,
            },
          });

          if (template.category === "STREAM") {
            const web = createData.web as Record<string, unknown>;
            await tx.webSourceConfig.create({
              data: {
                sourceId: base.id,
                url: Array.isArray(web.url) ? (web.url as string[]) : [],
                headers: (web.headers ?? null) as Prisma.InputJsonValue,
                crawlerEngine: String(web.crawlerEngine ?? "FETCH") as any,
                render: Boolean(web.render),
                parseRules: (web.parseRules ?? null) as Prisma.InputJsonValue,
                robotsRespect: web.robotsRespect !== false,
                proxyId: typeof web.proxyId === "string" ? web.proxyId : null,
              },
            });
          } else if (template.category === "RETRIEVAL" && template.isDarknet) {
            const darknet = createData.darknet as Record<string, unknown>;
            await tx.darknetSourceConfig.create({
              data: {
                sourceId: base.id,
                url: Array.isArray(darknet.url) ? (darknet.url as string[]) : [],
                headers: (darknet.headers ?? null) as Prisma.InputJsonValue,
                crawlerEngine: String(darknet.crawlerEngine ?? "FETCH") as any,
                proxyId: String(darknet.proxyId ?? ""),
                render: Boolean(darknet.render),
                parseRules: (darknet.parseRules ?? null) as Prisma.InputJsonValue,
              },
            });
          } else if (template.category === "RETRIEVAL" && !template.isDarknet) {
            const search = createData.search as Record<string, unknown>;
            await tx.searchEngineSourceConfig.create({
              data: {
                sourceId: base.id,
                platform: normalizeSearchPlatform(
                  search.platform ?? template.platform,
                  template.driver
                ),
                engine: String(search.engine ?? "CUSTOM") as any,
                objective: String(search.objective ?? ""),
                apiEndpoint:
                  typeof search.apiEndpoint === "string" ? search.apiEndpoint : null,
                options: (search.options ?? null) as Prisma.InputJsonValue,
                credentialId:
                  typeof search.credentialId === "string"
                    ? search.credentialId
                    : null,
                keywordStrategy: String(search.keywordStrategy ?? "AUTO") as any,
              },
            });
          } else if (template.category === "INTERACTIVE") {
            const social = createData.social as Record<string, unknown>;
            await tx.socialMediaSourceConfig.create({
              data: {
                sourceId: base.id,
                platform: String(social.platform ?? template.platform),
                config: social.config as Prisma.InputJsonObject,
                credentialId:
                  typeof social.credentialId === "string"
                    ? social.credentialId
                    : null,
                proxyId: typeof social.proxyId === "string" ? social.proxyId : null,
                keywordStrategy: String(social.keywordStrategy ?? "AUTO") as any,
              },
            });
          }

          await tx.sourceIdentity.create({
            data: {
              sourceId: base.id,
              category: task.identity.category,
              isDarknet: task.identity.isDarknet,
              platform: task.identity.platform,
              driver: task.identity.driver,
              intentType: task.identity.intentType,
              intentArgsHash: task.identity.intentArgsHash,
            },
          });

          created.push({
            key: task.key,
            sourceId: base.id,
            name: base.name,
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            failed.push({
              key: task.key,
              error: "Source name conflict",
            });
            continue;
          }
          throw error;
        }
      }
    });

    return json({
      created,
      skipped,
      invalid: [],
      failed,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      logger.warn("batch-create conflict", {
        error: logger.normalizeError(error),
      });
      return json({
        created: [],
        skipped,
        invalid: [],
        failed: (parsedBody?.items ?? []).map((item) => ({
          key: item.key,
          error: "Concurrent conflict, retry later",
        })),
      });
    }

    logger.error("batch-create failed", {
      error: logger.normalizeError(error),
    });

    if (parsedBody) {
      return json({
        created: [],
        skipped,
        invalid: [],
        failed: parsedBody.items
          .filter((item) => item.enabled)
          .map((item) => ({ key: item.key, error: "Batch creation failed" })),
      });
    }

    return serverError(error);
  }
}
