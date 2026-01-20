import { json, badRequest, serverError } from "@/app/api/_utils/http";
import prisma from "@/lib/prisma";
import { z } from "zod";

const UploadAuthSchema = z.object({
  platform: z.enum(["X", "TELEGRAM", "REDDIT", "XIAOHONGSHU", "DOUYIN"]),
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
    })),
    origins: z.array(z.any()).optional(),
  }),
});

const GATHER_SERVICE_URL = process.env.GATHER_SERVICE_URL || "http://localhost:8000";

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
    const platformNormalized = platform.toLowerCase();

    // Step 1: Verify auth with gather service
    console.log(`[auth] Verifying ${platform} auth with gather service...`);

    const verifyResponse = await fetch(`${GATHER_SERVICE_URL}/verify-auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: platformNormalized,
        auth_data: authData,
        headless: false, // Set to false for debugging, true for production
      }),
    });

    if (!verifyResponse.ok) {
      const errorText = await verifyResponse.text();
      console.error(`[auth] Gather service error: ${errorText}`);
      return serverError(new Error(`Gather service error: ${errorText}`));
    }

    const verifyResult = await verifyResponse.json();

    if (!verifyResult.valid) {
      return json({
        success: false,
        verified: false,
        message: verifyResult.message,
        details: verifyResult.details,
      }, 400);
    }

    // Step 2: Create or update Credential
    const credentialName = providedName || `${platform.toUpperCase()}_cookie_auth`;
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
          data: authData as any, // Store the entire storage_state
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
          data: authData as any,
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
      // Check with gather service
      const verifyResponse = await fetch(`${GATHER_SERVICE_URL}/verify-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: platformNormalized,
          auth_data: credential.data,
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
