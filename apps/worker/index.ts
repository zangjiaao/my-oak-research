import "./jobs/collect-query";
import "./jobs/collect-job";
import "./jobs/process-knowledge";
import { logger } from "@/lib/logger";
import { startWorkerHttpServer } from "./http/server";
import { syncQuerySchedules } from "./jobs/sync-query-schedules";
import { syncJobSchedules } from "./jobs/sync-job-schedules";

logger.info("Worker booted", {
  services: ["collect-query", "collect-job", "knowledge-process"],
});

syncQuerySchedules().catch((error) => {
  logger.error("failed to sync query schedules", {
    error: logger.normalizeError(error),
  });
});

syncJobSchedules().catch((error) => {
  logger.error("failed to sync job schedules", {
    error: logger.normalizeError(error),
  });
});

startWorkerHttpServer();
