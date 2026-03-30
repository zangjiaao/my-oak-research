-- CreateEnum
CREATE TYPE "TopicTermType" AS ENUM ('CORE', 'EXPANSION', 'EXCLUSION');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('TOPIC_RETRIEVAL', 'SOURCE_INGEST', 'SOURCE_ONESHOT');

-- CreateTable
CREATE TABLE "Topic" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "frequency" "QueryFrequency" NOT NULL DEFAULT 'MANUAL',
  "cronSchedule" TEXT,
  "vector" vector(1536),
  "profile" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicTerm" (
  "id" TEXT NOT NULL,
  "topicId" TEXT NOT NULL,
  "type" "TopicTermType" NOT NULL,
  "value" TEXT NOT NULL,
  "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TopicTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicSource" (
  "id" TEXT NOT NULL,
  "topicId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "retrievalPolicy" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TopicSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "JobType" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "frequency" "QueryFrequency" NOT NULL DEFAULT 'MANUAL',
  "cronSchedule" TEXT,
  "triggerMode" TEXT,
  "config" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobTopic" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "topicId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "JobTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSource" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "recallBindingOverride" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "JobSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "trigger" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "error" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentTopicScore" (
  "id" TEXT NOT NULL,
  "contentId" TEXT NOT NULL,
  "topicId" TEXT NOT NULL,
  "vectorScore" DOUBLE PRECISION,
  "keywordScore" DOUBLE PRECISION,
  "exclusionPenalty" DOUBLE PRECISION,
  "finalScore" DOUBLE PRECISION,
  "reason" TEXT,
  "explain" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContentTopicScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Topic_name_key" ON "Topic"("name");
CREATE UNIQUE INDEX "TopicTerm_topicId_type_value_key" ON "TopicTerm"("topicId", "type", "value");
CREATE INDEX "TopicTerm_topicId_type_idx" ON "TopicTerm"("topicId", "type");
CREATE UNIQUE INDEX "TopicSource_topicId_sourceId_key" ON "TopicSource"("topicId", "sourceId");
CREATE INDEX "TopicSource_sourceId_idx" ON "TopicSource"("sourceId");
CREATE UNIQUE INDEX "Job_name_key" ON "Job"("name");
CREATE UNIQUE INDEX "JobTopic_jobId_topicId_key" ON "JobTopic"("jobId", "topicId");
CREATE INDEX "JobTopic_topicId_idx" ON "JobTopic"("topicId");
CREATE UNIQUE INDEX "JobSource_jobId_sourceId_key" ON "JobSource"("jobId", "sourceId");
CREATE INDEX "JobSource_sourceId_idx" ON "JobSource"("sourceId");
CREATE INDEX "JobRun_jobId_createdAt_idx" ON "JobRun"("jobId", "createdAt");
CREATE UNIQUE INDEX "ContentTopicScore_contentId_topicId_key" ON "ContentTopicScore"("contentId", "topicId");
CREATE INDEX "ContentTopicScore_topicId_finalScore_idx" ON "ContentTopicScore"("topicId", "finalScore");
CREATE INDEX "ContentTopicScore_contentId_idx" ON "ContentTopicScore"("contentId");

-- AddForeignKey
ALTER TABLE "TopicTerm" ADD CONSTRAINT "TopicTerm_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicSource" ADD CONSTRAINT "TopicSource_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicSource" ADD CONSTRAINT "TopicSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobTopic" ADD CONSTRAINT "JobTopic_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobTopic" ADD CONSTRAINT "JobTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobSource" ADD CONSTRAINT "JobSource_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobSource" ADD CONSTRAINT "JobSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentTopicScore" ADD CONSTRAINT "ContentTopicScore_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentTopicScore" ADD CONSTRAINT "ContentTopicScore_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
