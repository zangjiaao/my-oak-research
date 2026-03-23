-- CreateEnum
CREATE TYPE "QueryContentFilterMode" AS ENUM ('TERM_AND_WORD_BOUNDARY');

-- CreateTable
CREATE TABLE "QuerySourcePolicy" (
    "id" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "contentFilterEnabled" BOOLEAN NOT NULL DEFAULT true,
    "contentFilterMode" "QueryContentFilterMode" NOT NULL DEFAULT 'TERM_AND_WORD_BOUNDARY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuerySourcePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuerySourcePolicy_queryId_sourceId_key" ON "QuerySourcePolicy"("queryId", "sourceId");

-- CreateIndex
CREATE INDEX "QuerySourcePolicy_sourceId_idx" ON "QuerySourcePolicy"("sourceId");

-- AddForeignKey
ALTER TABLE "QuerySourcePolicy" ADD CONSTRAINT "QuerySourcePolicy_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "Query"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuerySourcePolicy" ADD CONSTRAINT "QuerySourcePolicy_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
