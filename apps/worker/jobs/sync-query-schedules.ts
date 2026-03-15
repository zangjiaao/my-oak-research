import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { scheduleQueryCollect } from "@/lib/queue";

export async function syncQuerySchedules() {
  const queries = await prisma.query.findMany({
    select: {
      id: true,
      enabled: true,
      frequency: true,
      cronSchedule: true,
    },
  });

  await Promise.all(
    queries.map((query) =>
      scheduleQueryCollect({
        queryId: query.id,
        enabled: query.enabled,
        frequency: query.frequency,
        cronSchedule: query.cronSchedule,
      })
    )
  );

  logger.info("query schedules synced", {
    total: queries.length,
    enabled: queries.filter((query) => query.enabled).length,
  });
}
