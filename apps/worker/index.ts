import "./jobs/collect-query";
import "./jobs/process-knowledge";
import { logger } from "@/lib/logger";

logger.info("Worker booted", {
  services: ["collect-query", "knowledge-process"],
});
