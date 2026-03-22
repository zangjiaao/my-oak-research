import { createServer } from "node:http";

import { logger } from "@/lib/logger";
import { buildWorkerSourceCapabilities } from "../lib/source-capabilities";

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (typeof value !== "string") return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return defaultValue;
}

export function startWorkerHttpServer(): void {
  const enabled = parseBooleanEnv(
    process.env.WORKER_CAPABILITIES_HTTP_ENABLED,
    true
  );
  if (!enabled) {
    logger.info("worker capabilities http disabled");
    return;
  }

  const host = process.env.WORKER_CAPABILITIES_HOST || "0.0.0.0";
  const port = Number(process.env.WORKER_CAPABILITIES_PORT || 8100);
  if (!Number.isFinite(port) || port <= 0) {
    logger.warn("invalid WORKER_CAPABILITIES_PORT, skip capabilities http", {
      port: process.env.WORKER_CAPABILITIES_PORT,
    });
    return;
  }

  const server = createServer((req, res) => {
    const method = req.method || "GET";
    const url = req.url || "/";

    if (method === "GET" && url === "/health") {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.statusCode = 200;
      res.end(JSON.stringify({ status: "ok", service: "oak-worker" }));
      return;
    }

    if (method === "GET" && url === "/v1/source-capabilities") {
      const items = buildWorkerSourceCapabilities();
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          total: items.length,
          items,
        })
      );
      return;
    }

    res.statusCode = 404;
    res.end("Not Found");
  });

  server.listen(port, host, () => {
    logger.info("worker capabilities http started", { host, port });
  });

  server.on("error", (error) => {
    logger.error("worker capabilities http error", {
      error: logger.normalizeError(error),
    });
  });
}
