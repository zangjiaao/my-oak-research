import { json, badRequest, serverError } from "@/app/api/_utils/http";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  buildCredentialStorageKey,
  isApiKeyKind,
  kindToPlatform,
  platformToCredentialKind,
} from "@/lib/credential-utils";
import { encryptCredentialPayload, unwrapCredentialPayload } from "@/lib/credential-secret";
import { uploadFile } from "@/lib/storage";
import { z } from "zod";

const CreateCredentialSchema = z.object({
  name: z.string().trim().min(1, "Credential name is required"),
  kind: z.string().trim().min(1, "Credential kind is required"),
  sourceId: z.string().cuid().optional(),
  secret: z.string().trim().min(1).optional(),
});

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
      where.kind = platformToCredentialKind(platform);
    }

    const credentials = await prisma.credential.findMany({
      where,
      select: {
        id: true,
        name: true,
        kind: true,
        data: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    const sourceUsageRows = await prisma.source.groupBy({
      by: ["credentialId"],
      where: { credentialId: { not: null } },
      _count: { _all: true },
    });
    const searchUsageRows = await prisma.searchEngineSourceConfig.groupBy({
      by: ["credentialId"],
      where: { credentialId: { not: null } },
      _count: { _all: true },
    });
    const socialUsageRows = await prisma.socialMediaSourceConfig.groupBy({
      by: ["credentialId"],
      where: { credentialId: { not: null } },
      _count: { _all: true },
    });
    const usageMap = new Map<string, number>();
    const addUsage = (id: string | null, count: number) => {
      if (!id) return;
      usageMap.set(id, (usageMap.get(id) ?? 0) + count);
    };
    sourceUsageRows.forEach((item) => addUsage(item.credentialId, item._count._all));
    searchUsageRows.forEach((item) => addUsage(item.credentialId, item._count._all));
    socialUsageRows.forEach((item) => addUsage(item.credentialId, item._count._all));

    return json({
      credentials: credentials.map((credential) => {
        const payload = unwrapCredentialPayload(credential.data);
        const dataObject =
          payload && typeof payload === "object" && !Array.isArray(payload)
            ? (payload as Record<string, unknown>)
            : {};
        const storageKey =
          typeof dataObject.storageKey === "string" ? dataObject.storageKey : null;
        const authType =
          typeof dataObject.authType === "string" ? dataObject.authType : null;
        return {
          id: credential.id,
          name: credential.name,
          kind: credential.kind,
          platform: kindToPlatform(credential.kind),
          createdAt: credential.createdAt,
          updatedAt: credential.updatedAt,
          usageCount: usageMap.get(credential.id) ?? 0,
          authType,
          hasStorageObject: Boolean(storageKey),
          secretMasked: isApiKeyKind(credential.kind) ? "••••••••" : null,
        };
      }),
    });

  } catch (error) {
    logger.error("[credentials] GET error", { error: logger.normalizeError(error) });
    return serverError(error);
  }
}

/**
 * POST /api/follow/credentials
 *
 * Create API-key style credentials managed in DB.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = CreateCredentialSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid credential payload", {
        message: "Validation failed",
        details: z.flattenError(parsed.error),
      });
    }
    const { name, kind, sourceId, secret } = parsed.data;
    if (!isApiKeyKind(kind)) {
      return badRequest("Only api-key credentials are supported by this endpoint");
    }
    if (!secret) {
      return badRequest("Missing required secret for api-key credential");
    }
    const encryptedPayload = encryptCredentialPayload({
      authType: "api-key",
      secret,
    });
    const created = await prisma.credential.create({
      data: {
        name,
        kind,
        data: encryptedPayload as any,
      },
      select: {
        id: true,
        name: true,
        kind: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (sourceId) {
      await prisma.source.update({
        where: { id: sourceId },
        data: { credentialId: created.id },
      });
    }

    const storageKey = buildCredentialStorageKey({
      kind,
      credentialId: created.id,
      ext: "json",
    });
    await uploadFile(
      storageKey,
      Buffer.from(JSON.stringify({ type: "api-key", version: 1 }), "utf-8"),
      "application/json"
    );

    return json({
      success: true,
      credential: {
        ...created,
        platform: kindToPlatform(created.kind),
        usageCount: sourceId ? 1 : 0,
      },
    }, 201);
  } catch (error) {
    logger.error("[credentials] POST error", { error: logger.normalizeError(error) });
    return serverError(error);
  }
}
