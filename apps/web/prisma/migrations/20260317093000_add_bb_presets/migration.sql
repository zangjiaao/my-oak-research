-- CreateEnum
CREATE TYPE "public"."BbPresetStatus" AS ENUM ('ACTIVE', 'DEPRECATED', 'BROKEN');

-- CreateEnum
CREATE TYPE "public"."BbPresetSyncStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "public"."BbPreset" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "platform" TEXT NOT NULL,
    "scriptRelPath" TEXT NOT NULL,
    "scriptHash" TEXT NOT NULL,
    "scriptSnapshotKey" TEXT,
    "argsSchema" JSONB NOT NULL,
    "outputSchema" JSONB NOT NULL,
    "status" "public"."BbPresetStatus" NOT NULL DEFAULT 'ACTIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BbPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SourcePresetBinding" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcePresetBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BbPresetSyncLog" (
    "id" TEXT NOT NULL,
    "rootPath" TEXT NOT NULL,
    "status" "public"."BbPresetSyncStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "scannedCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "changedCount" INTEGER NOT NULL DEFAULT 0,
    "brokenCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "diff" JSONB,
    "error" TEXT,

    CONSTRAINT "BbPresetSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BbPreset_key_version_key" ON "public"."BbPreset"("key", "version");

-- CreateIndex
CREATE INDEX "BbPreset_platform_status_idx" ON "public"."BbPreset"("platform", "status");

-- CreateIndex
CREATE INDEX "BbPreset_key_isActive_idx" ON "public"."BbPreset"("key", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SourcePresetBinding_sourceId_presetId_key" ON "public"."SourcePresetBinding"("sourceId", "presetId");

-- CreateIndex
CREATE INDEX "SourcePresetBinding_sourceId_enabled_idx" ON "public"."SourcePresetBinding"("sourceId", "enabled");

-- AddForeignKey
ALTER TABLE "public"."SourcePresetBinding" ADD CONSTRAINT "SourcePresetBinding_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "public"."Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SourcePresetBinding" ADD CONSTRAINT "SourcePresetBinding_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "public"."BbPreset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
