import { badRequest, json, notFound, serverError } from "@/app/api/_utils/http";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { kindToPlatform, isApiKeyKind } from "@/lib/credential-utils";
import { unwrapCredentialPayload } from "@/lib/credential-secret";

type VerifyResponse = {
  verified: boolean;
  message: string;
  details?: Record<string, unknown>;
};

const DEFAULT_ENDPOINTS = {
  parallel: "https://api.parallel.ai/v1beta/search",
  tavily: "https://api.tavily.com/search",
  anspire: "https://plugin.anspire.cn/api/ntsearch/prosearch",
} as const;

function extractObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

async function verifyApiKey(platform: string, secret: string): Promise<VerifyResponse> {
  if (!secret.trim()) {
    return {
      verified: false,
      message: "Missing API key secret",
    };
  }
  try {
    if (platform === "parallel") {
      const response = await fetch(
        DEFAULT_ENDPOINTS.parallel,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": secret,
          },
          body: JSON.stringify({
            mode: "one-shot",
            objective: "auth health check",
            search_queries: ["auth health check"],
            max_results: 1,
          }),
        }
      );
      return {
        verified: response.ok,
        message: response.ok ? "Parallel API key is valid" : `Parallel API check failed (${response.status})`,
      };
    }
    if (platform === "tavily") {
      const response = await fetch(
        DEFAULT_ENDPOINTS.tavily,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: secret,
            query: "auth health check",
            max_results: 1,
          }),
        }
      );
      return {
        verified: response.ok,
        message: response.ok ? "Tavily API key is valid" : `Tavily API check failed (${response.status})`,
      };
    }
    if (platform === "anspire") {
      const endpoint = DEFAULT_ENDPOINTS.anspire;
      const url = new URL(endpoint);
      url.searchParams.set("query", "auth health check");
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      return {
        verified: response.ok,
        message: response.ok ? "Anspire API key is valid" : `Anspire API check failed (${response.status})`,
      };
    }
    return {
      verified: false,
      message: `Unsupported API-key platform: ${platform}`,
    };
  } catch (error) {
    return {
      verified: false,
      message: `API key verification failed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const credential = await prisma.credential.findUnique({ where: { id } });
    if (!credential) {
      return notFound(`Credential ${id} not found`);
    }
    const platform = kindToPlatform(credential.kind);
    const payload = extractObject(unwrapCredentialPayload(credential.data));

    if (isApiKeyKind(credential.kind)) {
      const secret = String(payload.secret ?? "");
      const result = await verifyApiKey(platform, secret);
      return json(result);
    }

    const gatherServiceUrl = process.env.GATHER_SERVICE_URL || "http://localhost:8000";
    const stateFile = typeof payload.stateFile === "string" ? payload.stateFile : null;
    const authData = stateFile ? { state_file: stateFile } : { auth_data: payload };
    const response = await fetch(`${gatherServiceUrl}/v1/verify-auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform,
        headless: false,
        ...authData,
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      return badRequest("Verification failed", { message: errorText });
    }
    const verifyResult = await response.json();
    return json({
      verified: Boolean(verifyResult.valid),
      message: String(verifyResult.message ?? "Verification completed"),
      details: verifyResult.details ?? null,
    });
  } catch (error) {
    logger.error("[credentials] verify error", { error: logger.normalizeError(error) });
    return serverError(error);
  }
}
