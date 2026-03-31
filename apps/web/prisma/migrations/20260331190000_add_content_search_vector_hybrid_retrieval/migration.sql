ALTER TABLE "Content"
ADD COLUMN IF NOT EXISTS "searchVector" tsvector;

CREATE INDEX IF NOT EXISTS "Content_searchVector_idx"
ON "Content"
USING GIN ("searchVector");

CREATE OR REPLACE FUNCTION content_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('simple', coalesce(NEW."title", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW."summary", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW."markdown", '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS content_search_vector_trigger ON "Content";

CREATE TRIGGER content_search_vector_trigger
BEFORE INSERT OR UPDATE OF "title", "summary", "markdown"
ON "Content"
FOR EACH ROW
EXECUTE FUNCTION content_search_vector_update();

UPDATE "Content"
SET "searchVector" =
  setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
  setweight(to_tsvector('simple', coalesce("summary", '')), 'B') ||
  setweight(to_tsvector('simple', coalesce("markdown", '')), 'C')
WHERE "searchVector" IS NULL;
