import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type WebDeriveIoEvent =
  | "derive-search-request-response"
  | "derive-llm-request-response"
  | "derive-final-output";

type WebDeriveIoEntry = {
  event: WebDeriveIoEvent;
  time?: string;
  requestId: string;
  provider?: string;
  query?: string;
  url?: string;
  method?: string;
  statusCode?: number;
  request?: unknown;
  response?: unknown;
  details?: unknown;
  error?: string;
};

const WEB_DERIVE_IO_LOG_ENABLED =
  process.env.WEB_DERIVE_IO_LOG_ENABLED === "true";
const WEB_DERIVE_IO_LOG_DIR = resolveLogDir(
  process.env.WEB_DERIVE_IO_LOG_DIR || "apps/web/logs"
);
const WEB_DERIVE_IO_LOG_MAX_CHARS = resolveMaxChars(
  process.env.WEB_DERIVE_IO_LOG_MAX_CHARS
);

function resolveLogDir(rawDir: string): string {
  if (!rawDir.trim()) {
    return resolve(process.cwd(), "apps/web/logs");
  }
  if (isAbsolute(rawDir)) return rawDir;
  if (rawDir.startsWith("apps/")) {
    const repoRoot = findRepoRoot(process.cwd());
    if (repoRoot) return resolve(repoRoot, rawDir);
  }
  return resolve(process.cwd(), rawDir);
}

function findRepoRoot(start: string): string | null {
  let current = resolve(start);
  while (true) {
    const packageJsonPath = resolve(current, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const payload = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
          workspaces?: unknown;
        };
        if (payload.workspaces) {
          return current;
        }
      } catch {
        // ignore and continue upward
      }
    }
    const parent = resolve(current, "..");
    if (parent === current) return null;
    current = parent;
  }
}

function resolveMaxChars(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 256) return 12000;
  return Math.floor(parsed);
}

function truncateString(value: string): string {
  if (value.length <= WEB_DERIVE_IO_LOG_MAX_CHARS) return value;
  return `${value.slice(0, WEB_DERIVE_IO_LOG_MAX_CHARS)}...(truncated, total=${value.length})`;
}

function truncateValue(value: unknown): JsonValue {
  if (value == null) return null;
  if (typeof value === "string") return truncateString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => truncateValue(item));
  if (typeof value === "object") {
    const output: Record<string, JsonValue> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = truncateValue(nested);
    }
    return output;
  }
  return String(value);
}

function parseJsonString(value: string): unknown {
  const text = value.trim();
  if (!text) return null;
  if (!(text.startsWith("{") || text.startsWith("["))) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function redactSensitive(value: unknown): JsonValue {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (typeof value === "string") {
    const parsed = parseJsonString(value);
    if (parsed == null) return truncateValue(value);
    const redacted = redactSensitive(parsed);
    return truncateValue(JSON.stringify(redacted));
  }
  if (typeof value !== "object") return truncateValue(value);

  const output: Record<string, JsonValue> = {};
  for (const [key, nested] of Object.entries(value)) {
    const lowered = key.toLowerCase();
    if (
      lowered.includes("authorization") ||
      lowered.includes("api-key") ||
      lowered.includes("api_key") ||
      lowered.includes("apikey") ||
      lowered.includes("token") ||
      lowered.includes("cookie")
    ) {
      output[key] = "<redacted>";
      continue;
    }
    output[key] = redactSensitive(nested);
  }
  return output;
}

export function writeWebDeriveIoLog(entry: WebDeriveIoEntry): void {
  if (!WEB_DERIVE_IO_LOG_ENABLED) return;
  try {
    const now = new Date();
    const dateTag = now.toISOString().slice(0, 10);
    const filePath = resolve(WEB_DERIVE_IO_LOG_DIR, `derive-api-io-${dateTag}.jsonl`);
    mkdirSync(dirname(filePath), { recursive: true });
    const payload = {
      ...entry,
      time: entry.time ?? now.toISOString(),
      request: redactSensitive(truncateValue(entry.request)),
      response: redactSensitive(truncateValue(entry.response)),
      details: redactSensitive(truncateValue(entry.details)),
    };
    appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
  } catch {
    // best effort logging, do not block API responses
  }
}

export function isWebDeriveIoLogEnabled(): boolean {
  return WEB_DERIVE_IO_LOG_ENABLED;
}
