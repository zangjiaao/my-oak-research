-- CreateEnum
CREATE TYPE "public"."TaskStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "public"."QueryRun" (
    "id" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "status" "public"."TaskStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TaskEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QueryRun_queryId_createdAt_idx" ON "public"."QueryRun"("queryId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskEvent_runId_createdAt_idx" ON "public"."TaskEvent"("runId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."QueryRun" ADD CONSTRAINT "QueryRun_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "public"."Query"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TaskEvent" ADD CONSTRAINT "TaskEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."QueryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
