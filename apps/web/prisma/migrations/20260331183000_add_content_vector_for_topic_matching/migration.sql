ALTER TABLE "Content"
ADD COLUMN IF NOT EXISTS "vector" vector(1536);

CREATE INDEX IF NOT EXISTS "Content_vector_idx"
ON "Content"
USING ivfflat ("vector" vector_cosine_ops)
WITH (lists = 100);

CREATE INDEX IF NOT EXISTS "Topic_vector_idx"
ON "Topic"
USING ivfflat ("vector" vector_cosine_ops)
WITH (lists = 100);
