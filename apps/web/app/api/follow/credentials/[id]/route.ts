import { json, serverError, notFound, badRequest } from "@/app/api/_utils/http";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { deleteFile } from "@/lib/storage";
import { encryptCredentialPayload, unwrapCredentialPayload } from "@/lib/credential-secret";
import { isApiKeyKind } from "@/lib/credential-utils";
import { z } from "zod";

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

function extractStorageKey(data: unknown): string | null {
  const payload = unwrapCredentialPayload(data);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const storageKey = (payload as Record<string, unknown>).storageKey;
  if (typeof storageKey === "string" && storageKey.trim()) {
    return storageKey.trim();
  }
  return null;
}

function extractProfileName(data: unknown): string | null {
  const payload = unwrapCredentialPayload(data);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const profileName = (payload as Record<string, unknown>).profileName;
  if (typeof profileName === "string" && profileName.trim()) {
    return profileName.trim();
  }
  return null;
}

const PatchCredentialSchema = z.object({
  name: z.string().trim().min(1).optional(),
  secret: z.string().trim().min(1).optional(),
});

/**
 * DELETE /api/follow/credentials/[id]
 * 
 * Delete a specific credential by ID.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const GATHER_SERVICE_URL = process.env.GATHER_SERVICE_URL || "http://localhost:8000";

    const credential = await prisma.credential.findUnique({
      where: { id },
    });

    if (!credential) {
      return notFound(`Credential ${id} not found`);
    }

    // Step 1: If it's a WhatsApp profile, notify gather service to delete the directory
    if (credential.kind === "whatsapp-profile") {
      try {
        const profileName = extractProfileName(credential.data);

        if (profileName) {
          logger.info("[credentials] Deleting WhatsApp profile from gather", { profileName });
          const response = await fetch(`${GATHER_SERVICE_URL}/delete-profile/${profileName}`, {
            method: "DELETE",
          });

          if (!response.ok) {
            const errorText = await response.text();
            logger.warn("[credentials] Failed to delete WhatsApp profile in gather", {
              profileName,
              errorText,
            });
            // We continue anyway to delete the database record
          }
        }
      } catch (err) {
        logger.error("[credentials] Error notifying gather service for profile deletion", {
          error: logger.normalizeError(err),
        });
      }
    }

    const stateFile = extractStateFilePath(credential.data);
    if (stateFile) {
      try {
        const response = await fetch(`${GATHER_SERVICE_URL}/auth/state-file`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stateFile }),
        });
        if (!response.ok) {
          const errorText = await response.text();
          logger.warn("[credentials] Failed to delete auth state file from gather", {
            stateFile,
            errorText,
          });
        }
      } catch (err) {
        logger.error("[credentials] Error deleting auth state file from gather", {
          error: logger.normalizeError(err),
        });
      }
    }

    const storageKey = extractStorageKey(credential.data);
    if (storageKey) {
      try {
        await deleteFile(storageKey);
      } catch (err) {
        logger.warn("[credentials] Failed to delete storage object", {
          storageKey,
          error: logger.normalizeError(err),
        });
      }
    }

    // Step 2: Delete from database
    await prisma.credential.delete({
      where: { id },
    });

    logger.info("[credentials] Deleted credential", { id, name: credential.name, kind: credential.kind });

    return json({
      success: true,
      message: `Credential "${credential.name}" deleted successfully`,
    });

  } catch (error) {
    logger.error("[credentials] DELETE error", { error: logger.normalizeError(error) });
    return serverError(error);
  }
}

/**
 * PATCH /api/follow/credentials/[id]
 *
 * Update credential display name and/or rotate secret for API key kinds.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = PatchCredentialSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid credential patch payload", {
        message: "Validation failed",
        details: z.flattenError(parsed.error),
      });
    }
    if (!parsed.data.name && !parsed.data.secret) {
      return badRequest("At least one of name or secret must be provided");
    }

    const existing = await prisma.credential.findUnique({ where: { id } });
    if (!existing) {
      return notFound(`Credential ${id} not found`);
    }

    let nextData: unknown = existing.data;
    if (parsed.data.secret) {
      if (!isApiKeyKind(existing.kind)) {
        return badRequest("Secret rotation is only supported for api-key credentials");
      }
      const current = unwrapCredentialPayload(existing.data);
      const currentObject =
        current && typeof current === "object" && !Array.isArray(current)
          ? (current as Record<string, unknown>)
          : {};
      nextData = encryptCredentialPayload({
        ...currentObject,
        authType: "api-key",
        secret: parsed.data.secret,
      });
    }

    const updated = await prisma.credential.update({
      where: { id },
      data: {
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.secret ? { data: nextData as any } : {}),
      },
      select: {
        id: true,
        name: true,
        kind: true,
        updatedAt: true,
      },
    });

    return json({
      success: true,
      credential: updated,
    });
  } catch (error) {
    logger.error("[credentials] PATCH error", { error: logger.normalizeError(error) });
    return serverError(error);
  }
}
