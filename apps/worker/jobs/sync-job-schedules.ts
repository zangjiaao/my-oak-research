import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { scheduleCollectJob } from "@/lib/queue";

const prismaAny = prisma as any;

export async function syncJobSchedules() {
  const jobs = await prismaAny.job.findMany({
    select: {
      id: true,
      enabled: true,
      frequency: true,
      cronSchedule: true,
    },
  });

  await Promise.all(
    jobs.map((job: any) =>
      scheduleCollectJob({
        jobId: job.id,
        enabled: job.enabled,
        frequency: job.frequency,
        cronSchedule: job.cronSchedule,
      })
    )
  );

  logger.info("job schedules synced", {
    total: jobs.length,
    enabled: jobs.filter((job: any) => job.enabled).length,
  });
}
