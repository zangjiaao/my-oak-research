ALTER TABLE "public"."SearchEngineSourceConfig"
ADD COLUMN "objective" TEXT;

UPDATE "public"."SearchEngineSourceConfig"
SET "objective" = COALESCE("query", '');

ALTER TABLE "public"."SearchEngineSourceConfig"
ALTER COLUMN "objective" SET NOT NULL;

ALTER TABLE "public"."SearchEngineSourceConfig"
DROP COLUMN "query",
DROP COLUMN "region",
DROP COLUMN "lang";
