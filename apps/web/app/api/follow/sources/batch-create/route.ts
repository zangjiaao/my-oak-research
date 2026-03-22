import { z } from "zod";

import { json, badRequest, serverError } from "@/app/api/_utils/http";
import { Prisma } from "@/app/generated/prisma";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  SOURCE_BATCH_TEMPLATE_MAP,
  buildIdentity,
  buildSourceCreateData,
  identityKey,
  isUniqueViolation,
  listMissingRequirements,
  sourceIdentityFromSource,
} from "@/lib/source-batch";
import { syncSocialPresetBinding } from "@/lib/source-preset-binding";

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
      rateLimit: z.number().int().min(1).max(600).optional(),
      proxyId: z.string().cuid().nullable().optional(),
    })
    .optional(),
});

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

      const template = SOURCE_BATCH_TEMPLATE_MAP.get(item.key);
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
          type: true,
          platform: true,
          driver: true,
          intentType: true,
          intentArgsHash: true,
        },
      }),
      prisma.source.findMany({
        select: {
          type: true,
          web: { select: { sourceId: true } },
          darknet: { select: { sourceId: true } },
          search: { select: { sourceId: true, platform: true } },
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

    const creationQueue: Array<{
      key: string;
      identity: ReturnType<typeof buildIdentity>;
      item: z.infer<typeof BatchCreateItemSchema>;
    }> = [];

    for (const item of enabledItems) {
      const template = SOURCE_BATCH_TEMPLATE_MAP.get(item.key);
      if (!template) continue;

      const identity = buildIdentity(template, item.config);
      const key = identityKey(identity);
      if (existingIdentityKeys.has(key)) {
        skipped.push({ key: item.key, reason: "EXISTS" });
        continue;
      }
      existingIdentityKeys.add(key);
      creationQueue.push({ key: item.key, identity, item });
    }

    const created: Array<{ key: string; sourceId: string; name: string }> = [];

    await prisma.$transaction(async (tx) => {
      for (const task of creationQueue) {
        const template = SOURCE_BATCH_TEMPLATE_MAP.get(task.key);
        if (!template) continue;

        const createData = buildSourceCreateData({
          template,
          config: task.item.config,
          defaults: parsed.data.defaults,
          credentialRefs: task.item.credentialRefs,
          identity: task.identity,
        }) as Record<string, unknown>;

        const base = await tx.source.create({
          data: {
            name: String(createData.name),
            description:
              typeof createData.description === "string"
                ? createData.description
                : null,
            type: template.type,
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

        if (template.type === "WEB") {
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
        } else if (template.type === "DARKNET") {
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
        } else if (template.type === "SEARCH_ENGINE") {
          const search = createData.search as Record<string, unknown>;
          await tx.searchEngineSourceConfig.create({
            data: {
              sourceId: base.id,
              platform: String(search.platform ?? template.platform) as any,
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
        } else if (template.type === "SOCIAL_MEDIA") {
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
          await syncSocialPresetBinding(tx, {
            sourceId: base.id,
            config: social.config,
          });
        }

        await tx.sourceIdentity.create({
          data: {
            sourceId: base.id,
            type: task.identity.type,
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
      }
    });

    return json({
      created,
      skipped,
      invalid: [],
      failed: [],
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
