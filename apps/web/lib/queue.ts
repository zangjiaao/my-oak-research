import { Queue, QueueEvents, JobsOptions, Worker } from "bullmq";
import { createClient } from "redis";
import { QueryFrequency } from "@/app/generated/prisma";

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

export const bullConnection = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
};

// Job payload
export type CollectJobPayload = {
  runId?: string;
  queryId: string;
  trigger?: "manual" | "scheduled";
};

export type KnowledgeProcessPayload = {
  knowledgeId: string;
  fileId: string;
  storageKey: string;
  vectorModel: string;
  chunkSize: number;
};

export const defaultJobOpts: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 100 },
};

// Queues
export const collectQueue = new Queue<CollectJobPayload>("collect-query", {
  connection: bullConnection,
});
export const collectQueueEvents = new QueueEvents("collect-query", {
  connection: bullConnection,
});
export const knowledgeQueue = new Queue<KnowledgeProcessPayload>("knowledge-process", {
  connection: bullConnection,
  defaultJobOptions: defaultJobOpts,
});
export const knowledgeQueueEvents = new QueueEvents("knowledge-process", {
  connection: bullConnection,
});
const SCHEDULED_COLLECT_JOB_NAME = "collect-scheduled";
const SCHEDULED_COLLECT_TZ = process.env.QUERY_SCHEDULE_TZ || "UTC";

function getQueryCollectJobId(queryId: string) {
  return `query:${queryId}:collect`;
}

export function resolveQueryCron(
  frequency: QueryFrequency,
  cronSchedule?: string | null
) {
  switch (frequency) {
    case QueryFrequency.HOURLY:
      return "0 * * * *";
    case QueryFrequency.DAILY:
      return "0 0 * * *";
    case QueryFrequency.WEEKLY:
      return "0 0 * * 1";
    case QueryFrequency.MONTHLY:
      return "0 0 1 * *";
    case QueryFrequency.CRONTAB:
      return cronSchedule?.trim() || null;
    default:
      return null;
  }
}

export async function unscheduleQueryCollect(queryId: string) {
  const scheduledJobId = getQueryCollectJobId(queryId);
  const repeatables = await collectQueue.getRepeatableJobs();
  const targets = repeatables.filter(
    (job) => job.name === SCHEDULED_COLLECT_JOB_NAME && job.id === scheduledJobId
  );
  await Promise.all(
    targets.map((job) => collectQueue.removeRepeatableByKey(job.key))
  );
}

export async function scheduleQueryCollect(options: {
  queryId: string;
  frequency: QueryFrequency;
  cronSchedule?: string | null;
  enabled: boolean;
}) {
  const { queryId, frequency, cronSchedule, enabled } = options;
  await unscheduleQueryCollect(queryId);
  if (!enabled) return;

  const cron = resolveQueryCron(frequency, cronSchedule);
  if (!cron) return;

  await collectQueue.add(
    SCHEDULED_COLLECT_JOB_NAME,
    { queryId, trigger: "scheduled" },
    {
      ...defaultJobOpts,
      jobId: getQueryCollectJobId(queryId),
      repeat: { pattern: cron, tz: SCHEDULED_COLLECT_TZ },
    }
  );
}

// Pub/Sub for task events (SSE/WebSocket can subscribe to `task:<runId>`)
export async function publishTaskEvent(runId: string, payload: unknown) {
  const pub = createClient({
    socket: { host: REDIS_HOST, port: REDIS_PORT },
    password: REDIS_PASSWORD,
  });
  await pub.connect();
  try {
    await pub.publish(`task:${runId}`, JSON.stringify(payload));
  } finally {
    await pub.quit();
  }
}

export async function publishContentEvent(payload: unknown) {
  const pub = createClient({
    socket: { host: REDIS_HOST, port: REDIS_PORT },
    password: REDIS_PASSWORD,
  });
  await pub.connect();
  try {
    await pub.publish("content:changed", JSON.stringify(payload));
  } finally {
    await pub.quit();
  }
}

// Optional helper to create a Worker in-process (app/worker should define its own files)
export function createCollectWorker(
  processor: (job: { data: CollectJobPayload }) => Promise<unknown>,
  concurrency = 3
) {
  return new Worker<CollectJobPayload>("collect-query", processor, {
    connection: bullConnection,
    concurrency,
  });
}

export function createKnowledgeWorker(
  processor: (job: { data: KnowledgeProcessPayload }) => Promise<unknown>,
  concurrency = 2
) {
  return new Worker<KnowledgeProcessPayload>("knowledge-process", processor, {
    connection: bullConnection,
    concurrency,
    lockDuration: 1800000, // 30 minutes for massive files
  });
}

