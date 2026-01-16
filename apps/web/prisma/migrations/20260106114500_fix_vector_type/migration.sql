-- Enable the vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Alter the embedding column from BYTEA to vector(1536)
-- Since it's currently empty (or has invalid data), we can drop and recreate or cast.
-- Using DROP and ADD as it's cleaner for Unsupported types in Prisma.
ALTER TABLE "KnowledgeChunk" DROP COLUMN "embedding";
ALTER TABLE "KnowledgeChunk" ADD COLUMN "embedding" vector(1536);
