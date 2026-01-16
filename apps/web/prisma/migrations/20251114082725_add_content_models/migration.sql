-- CreateEnum
CREATE TYPE "public"."ContentType" AS ENUM ('Web', 'Client', 'Darknet');

-- CreateTable
CREATE TABLE "public"."Content" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "type" "public"."ContentType" NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "url" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ContentKeyword" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,

    CONSTRAINT "ContentKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ContentEntity" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "persons" TEXT[],
    "orgs" TEXT[],
    "locations" TEXT[],

    CONSTRAINT "ContentEntity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Content_platform_time_idx" ON "public"."Content"("platform", "time");

-- CreateIndex
CREATE INDEX "Content_type_time_idx" ON "public"."Content"("type", "time");

-- CreateIndex
CREATE UNIQUE INDEX "ContentKeyword_contentId_keywordId_key" ON "public"."ContentKeyword"("contentId", "keywordId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentEntity_contentId_key" ON "public"."ContentEntity"("contentId");

-- AddForeignKey
ALTER TABLE "public"."ContentKeyword" ADD CONSTRAINT "ContentKeyword_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "public"."Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContentKeyword" ADD CONSTRAINT "ContentKeyword_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "public"."Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContentEntity" ADD CONSTRAINT "ContentEntity_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "public"."Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;
