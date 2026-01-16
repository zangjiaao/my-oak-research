-- CreateEnum
CREATE TYPE "public"."SourceType" AS ENUM ('RSS', 'RSSHUB', 'REDDIT', 'TELEGRAM', 'X', 'CUSTOM');

-- CreateTable
CREATE TABLE "public"."Source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."SourceType" NOT NULL,
    "url" TEXT,
    "config" JSONB,
    "headers" JSONB,
    "auth" JSONB,
    "rateLimit" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastFetchedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Source_type_idx" ON "public"."Source"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Source_name_key" ON "public"."Source"("name");
