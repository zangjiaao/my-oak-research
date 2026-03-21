ALTER TABLE "public"."Keyword"
ADD COLUMN "deriveLanguages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
