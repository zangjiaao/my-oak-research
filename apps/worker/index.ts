import "./jobs/collect-query";
import "./jobs/process-knowledge";
import { logger } from "@/lib/logger";
import { startWorkerHttpServer } from "./http/server";
import { syncQuerySchedules } from "./jobs/sync-query-schedules";

logger.info("Worker booted", {
  services: ["collect-query", "knowledge-process"],
});

syncQuerySchedules().catch((error) => {
  logger.error("failed to sync query schedules", {
    error: logger.normalizeError(error),
  });
});

startWorkerHttpServer();
