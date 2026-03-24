import { json, badRequest, serverError } from "@/app/api/_utils/http";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { uploadFile } from "@/lib/storage";
import {
  buildCredentialStorageKey,
  platformToCredentialKind,
} from "@/lib/credential-utils";
import { encryptCredentialPayload, unwrapCredentialPayload } from "@/lib/credential-secret";
import { z } from "zod";

const UploadAuthSchema = z.object({
  platform: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.toUpperCase()),
  sourceId: z.string().cuid().optional(), // If provided, associate with existing source
  sourceIds: z.array(z.string().cuid()).optional(),
  name: z.string().min(1, "Credential name is required").optional(),
  authData: z.object({
    cookies: z.array(z.object({
      name: z.string(),
      value: z.string(),
      domain: z.string(),
      path: z.string().optional(),
      secure: z.boolean().optional(),
      httpOnly: z.boolean().optional(),
      sameSite: z.string().optional(),
      expires: z.number().optional(),
    })).optional().default([]),
    origins: z.array(z.object({
      origin: z.string(),
      localStorage: z.array(z.object({
        name: z.string(),
        value: z.string(),
      })).optional(),
    })).optional().default([]),
  }).refine(
    (data) => (data.cookies && data.cookies.length > 0) || (data.origins && data.origins.length > 0),
    { message: "Auth data must contain either cookies or origins with localStorage data" }
  ),
});

const GATHER_SERVICE_URL = process.env.GATHER_SERVICE_URL || "http://localhost:8000";

function resolveVerifyPlatform(platform: string) {
  const normalized = platform.trim().toLowerCase();
  if (normalized === "twitter") return "x";
  return normalized;
}

function resolveCredentialKind(platform: string) {
  return platformToCredentialKind(platform);
}

function extractStateFilePath(data: unknown): string | null {
  const payload = unwrapCredentialPayload(data);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const stateFile = (payload as Record<string, unknown>).stateFile;
  if (typeof stateFile === "string" && stateFile.trim()) {
    return stateFile.trim();
  }
  return null;
}

function credentialNameFromInput(name: string | undefined, platformUpper: string): string {
  return name || `${platformUpper}_cookie_auth`;
}

async function associateCredentialWithSources(sourceIds: string[], credentialId: string) {
  if (sourceIds.length === 0) return;
  const uniqueSourceIds = Array.from(new Set(sourceIds));
  const existingCount = await prisma.source.count({
    where: { id: { in: uniqueSourceIds } },
  });
  if (existingCount !== uniqueSourceIds.length) {
    return false;
  }
  await prisma.$transaction([
    prisma.source.updateMany({
      where: { id: { in: uniqueSourceIds } },
      data: { credentialId },
    }),
    prisma.socialMediaSourceConfig.updateMany({
      where: { sourceId: { in: uniqueSourceIds } },
      data: { credentialId },
    }),
  ]);
  return true;
}

/**
 * POST /api/follow/sources/auth/[platform]/cookie
 * 
 * Upload and verify authentication cookies for a social media platform.
 * Creates or updates a Credential record with the auth data.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ platform: string }> }
) {
  try {
    const { platform } = await params;
    const platformNormalized = platform.toLowerCase();
    const verifyPlatform = resolveVerifyPlatform(platformNormalized);
    const contentType = req.headers.get("content-type") || "";

    // Special handling for WhatsApp profile (multipart/form-data)
    if (platformNormalized === "whatsapp" && contentType.includes("multipart/form-data")) {
      logger.info("[auth] Handling WhatsApp profile upload");
      const formData = await req.formData();
      const file = formData.get("file") as File;
      const name = formData.get("name") as string;
      const sourceId = formData.get("sourceId") as string;
      const sourceIdsRaw = formData.get("sourceIds") as string | null;
      let parsedSourceIds: string[] = [];
      if (typeof sourceIdsRaw === "string" && sourceIdsRaw.trim()) {
        try {
          parsedSourceIds = z.array(z.string().cuid()).parse(JSON.parse(sourceIdsRaw));
        } catch {
          return badRequest("Invalid sourceIds");
        }
      }
      const targetSourceIds = Array.from(
        new Set([
          ...(sourceId?.trim() ? [sourceId.trim()] : []),
          ...parsedSourceIds,
        ])
      );

      if (!file) {
        return badRequest("Missing profile file");
      }

      // Forward to gather service
      const gatherFormData = new FormData();
      gatherFormData.append("file", file);
      gatherFormData.append("profile_name", name || "default");
      gatherFormData.append("platform", "whatsapp");

      const verifyResponse = await fetch(`${GATHER_SERVICE_URL}/v1/auth/profile`, {
        method: "POST",
        body: gatherFormData,
      });

      if (!verifyResponse.ok) {
        const errorText = await verifyResponse.text();
        logger.error("[auth] Gather service upload-profile error", { errorText });
        return serverError(new Error(`Gather service error: ${errorText}`));
      }

      const verifyResult = await verifyResponse.json();

      if (!verifyResult.success || !verifyResult.verified) {
        return json({
          success: false,
          verified: verifyResult.verified,
          message: verifyResult.message,
          details: verifyResult.details,
        }, 400);
      }

      // Create or update Credential for WhatsApp Profile
      const credentialName = name || `WHATSAPP_profile_auth`;
      const credentialKind = "whatsapp-profile";

      const existingCredential = await prisma.credential.findFirst({
        where: {
          name: credentialName,
          kind: credentialKind,
        },
      });

      let credential;
      const fileBytes = Buffer.from(await file.arrayBuffer());
      const storageKey = buildCredentialStorageKey({
        kind: credentialKind,
        credentialId: null,
        ext: "zip",
      });
      await uploadFile(
        storageKey,
        fileBytes,
        "application/zip",
        {
          kind: credentialKind,
          platform: "whatsapp",
          profileName: String(verifyResult.profile_name ?? ""),
        }
      );
      const authData = {
        profileName: verifyResult.profile_name,
        authType: "profile",
        storageKey,
      };

      if (existingCredential) {
        credential = await prisma.credential.update({
          where: { id: existingCredential.id },
          data: {
            data: encryptCredentialPayload(authData) as any,
            updatedAt: new Date(),
          },
        });
      } else {
        credential = await prisma.credential.create({
          data: {
            name: credentialName,
            kind: credentialKind,
            data: encryptCredentialPayload(authData) as any,
          },
        });
      }

      if (targetSourceIds.length > 0) {
        const associated = await associateCredentialWithSources(targetSourceIds, credential.id);
        if (!associated) {
          return badRequest("One or more sourceIds do not exist");
        }
        logger.info("[auth] Associated credential with sources", {
          credentialId: credential.id,
          sourceIds: targetSourceIds,
        });
      }

      return json({
        success: true,
        verified: true,
        message: "WhatsApp profile uploaded and verified successfully",
        credentialId: credential.id,
      });
    }

    // Standard JSON handling for other platforms (Cookies/LocalStorage)
    const body = await req.json();

    // Add platform to body for validation
    const dataToValidate = {
      ...body,
      platform: platform.toUpperCase(),
    };

    const parsed = UploadAuthSchema.safeParse(dataToValidate);
    if (!parsed.success) {
      return badRequest("Invalid auth data", {
        message: "Validation failed",
        details: z.flattenError(parsed.error),
      });
    }

    const { authData, sourceId, sourceIds, name: providedName } = parsed.data;
    const targetSourceIds = Array.from(
      new Set([...(sourceIds ?? []), ...(sourceId ? [sourceId] : [])])
    );

    const credentialName = credentialNameFromInput(providedName, platform.toUpperCase());
    const persistStateResponse = await fetch(`${GATHER_SERVICE_URL}/v1/auth/state-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: verifyPlatform,
        auth_data: authData,
        name: credentialName,
      }),
    });
    if (!persistStateResponse.ok) {
      const errorText = await persistStateResponse.text();
      logger.error("[auth] Persist state file failed", { errorText });
      return serverError(new Error(`Failed to persist auth state file: ${errorText}`));
    }
    const persistStateResult = await persistStateResponse.json();
    const stateFile = persistStateResult?.stateFile;
    if (typeof stateFile !== "string" || !stateFile.trim()) {
      return serverError(new Error("Failed to persist auth state file: missing stateFile"));
    }
    logger.info("[auth] Verifying auth with gather state file", { platform });
    const verifyResponse = await fetch(`${GATHER_SERVICE_URL}/v1/verify-auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: verifyPlatform,
        state_file: stateFile,
        headless: false,
      }),
    });
    if (!verifyResponse.ok) {
      const errorText = await verifyResponse.text();
      logger.error("[auth] Gather service verify-auth error", { errorText });
      return serverError(new Error(`Gather service error: ${errorText}`));
    }
    const verifyResult = await verifyResponse.json();
    if (!verifyResult.valid) {
      await fetch(`${GATHER_SERVICE_URL}/v1/auth/state-file`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateFile }),
      }).catch(() => undefined);
      return json(
        {
          success: false,
          verified: false,
          message: verifyResult.message,
          details: verifyResult.details,
        },
        400
      );
    }

    // Step 2: Create or update Credential
    const credentialKind = resolveCredentialKind(platformNormalized);

    logger.info("[auth] Creating/updating credential", {
      credentialName,
      credentialKind,
    });

    const existingCredential = await prisma.credential.findFirst({
      where: {
        name: credentialName,
        kind: credentialKind,
      },
    });

    let credential;
    const artifactStorageKey = buildCredentialStorageKey({
      kind: credentialKind,
      credentialId: existingCredential?.id ?? null,
      ext: "json",
    });
    await uploadFile(
      artifactStorageKey,
      Buffer.from(JSON.stringify(authData), "utf-8"),
      "application/json",
      {
        kind: credentialKind,
        platform: verifyPlatform,
        stateFile,
      }
    );
    if (existingCredential) {
      // Update existing credential
      credential = await prisma.credential.update({
        where: { id: existingCredential.id },
        data: {
          data: encryptCredentialPayload({
            authType: "state-file",
            stateFile,
            storageKey: artifactStorageKey,
          }) as any,
          updatedAt: new Date(),
        },
      });
      logger.info("[auth] Updated existing credential", { credentialId: credential.id });
    } else {
      // Create new credential
      credential = await prisma.credential.create({
        data: {
          name: credentialName,
          kind: credentialKind,
          data: encryptCredentialPayload({
            authType: "state-file",
            stateFile,
            storageKey: artifactStorageKey,
          }) as any,
        },
      });
      logger.info("[auth] Created new credential", { credentialId: credential.id });
    }

    if (targetSourceIds.length > 0) {
      const associated = await associateCredentialWithSources(targetSourceIds, credential.id);
      if (!associated) {
        return badRequest("One or more sourceIds do not exist");
      }
      logger.info("[auth] Associated credential with sources", {
        sourceIds: targetSourceIds,
        credentialId: credential.id,
      });
    }

    return json({
      success: true,
      verified: true,
      message: verifyResult.message,
      credentialId: credential.id,
      details: {
        ...verifyResult.details,
        credentialName: credential.name,
        credentialKind: credential.kind,
      },
    });

  } catch (error) {
    logger.error("[auth] POST error", { error: logger.normalizeError(error) });
    return serverError(error);
  }
}

/**
 * GET /api/follow/sources/auth/[platform]/cookie
 * 
 * Get the current auth status for a platform.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ platform: string }> }
) {
  try {
    const { platform } = await params;
    const platformNormalized = platform.toLowerCase();
    const verifyPlatform = resolveVerifyPlatform(platformNormalized);
    const credentialKind = resolveCredentialKind(platformNormalized);
    const { searchParams } = new URL(req.url);
    const verify = searchParams.get("verify") === "true";
    const credentialId = searchParams.get("credentialId");

    const credential = credentialId
      ? await prisma.credential.findFirst({
          where: {
            id: credentialId,
            kind: credentialKind,
          },
        })
      : await prisma.credential.findFirst({
          where: { kind: credentialKind },
          orderBy: { updatedAt: "desc" },
        });

    if (!credential) {
      return json({
        authenticated: false,
        message: credentialId
          ? `Credential not found for ${platform}`
          : `No authentication found for ${platform}`,
      });
    }

    if (verify) {
      const stateFile = extractStateFilePath(credential.data);
      const rawPayload = unwrapCredentialPayload(credential.data);
      // Check with gather service
      const verifyResponse = await fetch(`${GATHER_SERVICE_URL}/v1/verify-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: verifyPlatform,
          ...(stateFile
            ? { state_file: stateFile }
            : { auth_data: rawPayload }),
        }),
      });

      if (verifyResponse.ok) {
        const verifyResult = await verifyResponse.json();
        return json({
          authenticated: verifyResult.valid,
          message: verifyResult.message,
          credentialId: credential.id,
          lastUpdated: credential.updatedAt,
          details: verifyResult.details,
        });
      }
    }

    return json({
      authenticated: true,
      message: `Authentication found for ${platform}`,
      credentialId: credential.id,
      lastUpdated: credential.updatedAt,
    });

  } catch (error) {
    logger.error("[auth] GET error", { error: logger.normalizeError(error) });
    return serverError(error);
  }
}

/**
 * DELETE /api/follow/sources/auth/[platform]/cookie
 * 
 * Remove authentication for a platform.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ platform: string }> }
) {
  try {
    const { platform } = await params;
    const platformNormalized = platform.toLowerCase();
    const credentialKind = resolveCredentialKind(platformNormalized);

    const deleted = await prisma.credential.deleteMany({
      where: { kind: credentialKind },
    });

    if (deleted.count === 0) {
      return json({
        success: false,
        message: `No authentication found for ${platform}`,
      }, 404);
    }

    return json({
      success: true,
      message: `Deleted ${deleted.count} credential(s) for ${platform}`,
    });

  } catch (error) {
    logger.error("[auth] DELETE error", { error: logger.normalizeError(error) });
    return serverError(error);
  }
}
