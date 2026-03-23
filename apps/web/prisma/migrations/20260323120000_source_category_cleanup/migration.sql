-- Migrate source classification from legacy type enum to category enum.

CREATE TYPE "public"."SourceCategory" AS ENUM ('STREAM', 'INTERACTIVE', 'RETRIEVAL');

ALTER TABLE "public"."Source"
  ADD COLUMN "isDarknet" BOOLEAN NOT NULL DEFAULT false;

UPDATE "public"."Source"
SET "isDarknet" = ("type"::text = 'DARKNET');

ALTER TABLE "public"."Source"
  ALTER COLUMN "type" TYPE TEXT USING "type"::text;

UPDATE "public"."Source"
SET "type" = CASE
  WHEN "type" = 'WEB' THEN 'STREAM'
  WHEN "type" = 'SOCIAL_MEDIA' THEN 'INTERACTIVE'
  WHEN "type" = 'SEARCH_ENGINE' THEN 'RETRIEVAL'
  WHEN "type" = 'DARKNET' THEN 'RETRIEVAL'
  ELSE 'RETRIEVAL'
END;

ALTER TABLE "public"."Source"
  ALTER COLUMN "type" TYPE "public"."SourceCategory" USING "type"::"public"."SourceCategory";

ALTER TABLE "public"."Source"
  RENAME COLUMN "type" TO "category";

ALTER TABLE "public"."SourceIdentity"
  ADD COLUMN "isDarknet" BOOLEAN NOT NULL DEFAULT false;

UPDATE "public"."SourceIdentity"
SET "isDarknet" = ("type"::text = 'DARKNET');

ALTER TABLE "public"."SourceIdentity"
  ALTER COLUMN "type" TYPE TEXT USING "type"::text;

UPDATE "public"."SourceIdentity"
SET "type" = CASE
  WHEN "type" = 'WEB' THEN 'STREAM'
  WHEN "type" = 'SOCIAL_MEDIA' THEN 'INTERACTIVE'
  WHEN "type" = 'SEARCH_ENGINE' THEN 'RETRIEVAL'
  WHEN "type" = 'DARKNET' THEN 'RETRIEVAL'
  ELSE 'RETRIEVAL'
END;

ALTER TABLE "public"."SourceIdentity"
  ALTER COLUMN "type" TYPE "public"."SourceCategory" USING "type"::"public"."SourceCategory";

ALTER TABLE "public"."SourceIdentity"
  RENAME COLUMN "type" TO "category";

DROP INDEX IF EXISTS "public"."Source_type_idx";
CREATE INDEX "Source_category_idx" ON "public"."Source"("category");
CREATE INDEX "Source_isDarknet_idx" ON "public"."Source"("isDarknet");

DROP INDEX IF EXISTS "public"."SourceIdentity_type_platform_driver_intentType_idx";
DROP INDEX IF EXISTS "public"."SourceIdentity_type_platform_driver_intentType_intentArgsHash_key";

CREATE INDEX "SourceIdentity_category_isDarknet_platform_driver_intentType_idx"
  ON "public"."SourceIdentity"("category", "isDarknet", "platform", "driver", "intentType");

CREATE UNIQUE INDEX "SourceIdentity_category_isDarknet_platform_driver_intentType_intentArgsHash_key"
  ON "public"."SourceIdentity"("category", "isDarknet", "platform", "driver", "intentType", "intentArgsHash");

DROP TYPE "public"."SourceType";
