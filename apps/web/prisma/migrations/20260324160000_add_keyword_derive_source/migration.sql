ALTER TABLE "public"."Keyword"
ADD COLUMN "deriveSourceId" TEXT;

CREATE INDEX "Keyword_deriveSourceId_idx"
ON "public"."Keyword"("deriveSourceId");

ALTER TABLE "public"."Keyword"
ADD CONSTRAINT "Keyword_deriveSourceId_fkey"
FOREIGN KEY ("deriveSourceId")
REFERENCES "public"."Source"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
