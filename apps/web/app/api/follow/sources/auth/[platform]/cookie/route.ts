import { json, badRequest, serverError } from "@/app/api/_utils/http";
import prisma from "@/lib/prisma";
import { z } from "zod";

const UploadAuthSchema = z.object({
  platform: z.enum(["X", "TELEGRAM", "REDDIT", "XIAOHONGSHU", "DOUYIN", "TIKTOK", "WEIBO", "WHATSAPP", "INSTAGRAM", "FACEBOOK"]),
  sourceId: z.string().cuid().optional(), // If provided, associate with existing source
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

function extractStateFilePath(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const stateFile = (data as Record<string, unknown>).stateFile;
  if (typeof stateFile === "string" && stateFile.trim()) {
    return stateFile.trim();
  }
  return null;
}

function credentialNameFromInput(name: string | undefined, platformUpper: string): string {
  return name || `${platformUpper}_cookie_auth`;
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
    const contentType = req.headers.get("content-type") || "";

    // Special handling for WhatsApp profile (multipart/form-data)
    if (platformNormalized === "whatsapp" && contentType.includes("multipart/form-data")) {
      console.log(`[auth] Handling WhatsApp profile upload...`);
      const formData = await req.formData();
      const file = formData.get("file") as File;
      const name = formData.get("name") as string;
      const sourceId = formData.get("sourceId") as string;

      if (!file) {
        return badRequest("Missing profile file");
      }

      // Forward to gather service
      const gatherFormData = new FormData();
      gatherFormData.append("file", file);
      gatherFormData.append("profile_name", name || "default");
      gatherFormData.append("platform", "whatsapp");

      const verifyResponse = await fetch(`${GATHER_SERVICE_URL}/upload-profile`, {
        method: "POST",
        body: gatherFormData,
      });

      if (!verifyResponse.ok) {
        const errorText = await verifyResponse.text();
        console.error(`[auth] Gather service error: ${errorText}`);
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
      const authData = {
        profileName: verifyResult.profile_name,
        authType: "profile"
      };

      if (existingCredential) {
        credential = await prisma.credential.update({
          where: { id: existingCredential.id },
          data: {
            data: authData as any,
            updatedAt: new Date(),
          },
        });
      } else {
        credential = await prisma.credential.create({
          data: {
            name: credentialName,
            kind: credentialKind,
            data: authData as any,
          },
        });
      }

      // If sourceId is provided, associate this credential with the source
      if (sourceId) {
        const source = await prisma.source.findUnique({
          where: { id: sourceId },
          include: { social: true },
        });

        if (source) {
          console.log(`[auth] Associating credential ${credential.id} with source ${sourceId}`);
          await prisma.source.update({
            where: { id: sourceId },
            data: { credentialId: credential.id },
          });

          // Also update social config if exists
          if (source.social) {
            await prisma.socialMediaSourceConfig.update({
              where: { sourceId: sourceId },
              data: { credentialId: credential.id },
            });
          }
        }
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

    const { authData, sourceId, name: providedName } = parsed.data;

    const credentialName = credentialNameFromInput(providedName, platform.toUpperCase());
    const persistStateResponse = await fetch(`${GATHER_SERVICE_URL}/auth/state-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: platformNormalized,
        auth_data: authData,
        name: credentialName,
      }),
    });
    if (!persistStateResponse.ok) {
      const errorText = await persistStateResponse.text();
      console.error(`[auth] Persist state file failed: ${errorText}`);
      return serverError(new Error(`Failed to persist auth state file: ${errorText}`));
    }
    const persistStateResult = await persistStateResponse.json();
    const stateFile = persistStateResult?.stateFile;
    if (typeof stateFile !== "string" || !stateFile.trim()) {
      return serverError(new Error("Failed to persist auth state file: missing stateFile"));
    }
    console.log(`[auth] Verifying ${platform} auth with gather service via stateFile...`);
    const verifyResponse = await fetch(`${GATHER_SERVICE_URL}/verify-auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: platformNormalized,
        state_file: stateFile,
        headless: false,
      }),
    });
    if (!verifyResponse.ok) {
      const errorText = await verifyResponse.text();
      console.error(`[auth] Gather service error: ${errorText}`);
      return serverError(new Error(`Gather service error: ${errorText}`));
    }
    const verifyResult = await verifyResponse.json();
    if (!verifyResult.valid) {
      await fetch(`${GATHER_SERVICE_URL}/auth/state-file`, {
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
    const credentialKind = `${platformNormalized}-cookie`;

    console.log(`[auth] Using credential name: "${credentialName}" for kind: "${credentialKind}"`);

    const existingCredential = await prisma.credential.findFirst({
      where: {
        name: credentialName,
        kind: credentialKind,
      },
    });

    let credential;
    if (existingCredential) {
      // Update existing credential
      credential = await prisma.credential.update({
        where: { id: existingCredential.id },
        data: {
          data: { authType: "state-file", stateFile } as any,
          updatedAt: new Date(),
        },
      });
      console.log(`[auth] Updated existing credential: ${credential.id} (Name: ${credentialName})`);
    } else {
      // Create new credential
      credential = await prisma.credential.create({
        data: {
          name: credentialName,
          kind: credentialKind,
          data: { authType: "state-file", stateFile } as any,
        },
      });
      console.log(`[auth] Created new credential: ${credential.id} (Name: ${credentialName})`);
    }

    // Step 3: If sourceId provided, associate credential with source
    if (sourceId) {
      const source = await prisma.source.findUnique({
        where: { id: sourceId },
        include: { social: true },
      });

      if (source) {
        // Update source's credentialId
        await prisma.source.update({
          where: { id: sourceId },
          data: { credentialId: credential.id },
        });

        // Also update social config if exists
        if (source.social) {
          await prisma.socialMediaSourceConfig.update({
            where: { sourceId: sourceId },
            data: { credentialId: credential.id },
          });
        }

        console.log(`[auth] Associated credential with source: ${sourceId}`);
      }
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
    console.error("[auth] Error:", error);
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
    const credentialKind = `${platformNormalized}-cookie`;

    const credential = await prisma.credential.findFirst({
      where: { kind: credentialKind },
      orderBy: { updatedAt: "desc" },
    });

    if (!credential) {
      return json({
        authenticated: false,
        message: `No authentication found for ${platform}`,
      });
    }

    // Optionally verify if the credential is still valid
    const { searchParams } = new URL(req.url);
    const verify = searchParams.get("verify") === "true";

    if (verify) {
      const stateFile = extractStateFilePath(credential.data);
      // Check with gather service
      const verifyResponse = await fetch(`${GATHER_SERVICE_URL}/verify-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: platformNormalized,
          ...(stateFile
            ? { state_file: stateFile }
            : { auth_data: credential.data }),
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
    console.error("[auth] Error:", error);
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
    const credentialKind = `${platformNormalized}-cookie`;

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
    console.error("[auth] Error:", error);
    return serverError(error);
  }
}
