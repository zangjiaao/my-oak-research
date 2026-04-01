import "./jobs/collect-job";
import "./jobs/process-knowledge";
import "./jobs/topic-rescore";
import { logger } from "@/lib/logger";
import { startWorkerHttpServer } from "./http/server";
import { syncJobSchedules } from "./jobs/sync-job-schedules";

logger.info("Worker booted", {
  services: ["collect-job", "knowledge-process", "topic-rescore"],
});

syncJobSchedules().catch((error) => {
  logger.error("failed to sync job schedules", {
    error: logger.normalizeError(error),
  });
});

startWorkerHttpServer();
