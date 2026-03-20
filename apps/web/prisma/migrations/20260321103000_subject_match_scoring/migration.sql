CREATE TYPE "public"."KeywordStrategy" AS ENUM ('AUTO', 'RECALL_ONLY', 'PRECISION_ONLY', 'HYBRID');

CREATE TYPE "public"."ContentSubjectMatchSource" AS ENUM ('QUERY', 'GATHER', 'AI', 'FUSED');

ALTER TABLE "public"."SearchEngineSourceConfig"
ADD COLUMN "keywordStrategy" "public"."KeywordStrategy" NOT NULL DEFAULT 'AUTO';

ALTER TABLE "public"."SocialMediaSourceConfig"
ADD COLUMN "keywordStrategy" "public"."KeywordStrategy" NOT NULL DEFAULT 'AUTO';

CREATE TABLE "public"."ContentSubjectMatch" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "ruleScore" DOUBLE PRECISION,
    "aiScore" DOUBLE PRECISION,
    "matchScore" DOUBLE PRECISION,
    "matchedIncludes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "matchedExcludes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "matchSource" "public"."ContentSubjectMatchSource" NOT NULL DEFAULT 'QUERY',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentSubjectMatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentSubjectMatch_contentId_keywordId_key" ON "public"."ContentSubjectMatch"("contentId", "keywordId");
CREATE INDEX "ContentSubjectMatch_keywordId_matchScore_idx" ON "public"."ContentSubjectMatch"("keywordId", "matchScore");
CREATE INDEX "ContentSubjectMatch_keywordId_createdAt_idx" ON "public"."ContentSubjectMatch"("keywordId", "createdAt");
CREATE INDEX "ContentSubjectMatch_contentId_idx" ON "public"."ContentSubjectMatch"("contentId");
CREATE INDEX "ContentSubjectMatch_matchSource_idx" ON "public"."ContentSubjectMatch"("matchSource");

ALTER TABLE "public"."ContentSubjectMatch"
ADD CONSTRAINT "ContentSubjectMatch_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "public"."Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ContentSubjectMatch"
ADD CONSTRAINT "ContentSubjectMatch_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "public"."Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;
