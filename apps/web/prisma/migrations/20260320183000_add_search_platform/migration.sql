CREATE TYPE "public"."SearchPlatform" AS ENUM ('PARALLEL', 'TAVILY', 'ANSPIRE', 'CUSTOM');

ALTER TABLE "public"."SearchEngineSourceConfig"
ADD COLUMN "platform" "public"."SearchPlatform" NOT NULL DEFAULT 'CUSTOM';

UPDATE "public"."SearchEngineSourceConfig"
SET "platform" = CASE
  WHEN LOWER(COALESCE("options"->>'provider', '')) LIKE '%parallel%' THEN 'PARALLEL'::"public"."SearchPlatform"
  WHEN LOWER(COALESCE("options"->>'provider', '')) LIKE '%tavily%' THEN 'TAVILY'::"public"."SearchPlatform"
  WHEN LOWER(COALESCE("options"->>'provider', '')) LIKE '%anspire%' THEN 'ANSPIRE'::"public"."SearchPlatform"
  WHEN LOWER(COALESCE("apiEndpoint", '')) LIKE '%parallel.ai%' THEN 'PARALLEL'::"public"."SearchPlatform"
  WHEN LOWER(COALESCE("apiEndpoint", '')) LIKE '%tavily.com%' THEN 'TAVILY'::"public"."SearchPlatform"
  WHEN LOWER(COALESCE("apiEndpoint", '')) LIKE '%anspire.cn%' THEN 'ANSPIRE'::"public"."SearchPlatform"
  ELSE 'CUSTOM'::"public"."SearchPlatform"
END;
