import { createBbPresetSyncWorker } from "@/lib/queue";
import { logger } from "@/lib/logger";
import { syncBbPresets } from "@/lib/bb-presets";

export const bbPresetSyncWorker = createBbPresetSyncWorker(async (job) => {
  const { rootPath, trigger } = job.data;
  logger.info("bb preset sync job started", {
    trigger: trigger ?? "manual",
    rootPath: rootPath ?? process.env.BB_SITE_ROOT,
  });

  const summary = await syncBbPresets({ rootPath });

  logger.info("bb preset sync job finished", summary);
  return summary;
});
