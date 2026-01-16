-- CreateEnum
CREATE TYPE "public"."QueryFrequency" AS ENUM ('MANUAL', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "public"."Query" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "frequency" "public"."QueryFrequency" NOT NULL DEFAULT 'MANUAL',
    "rules" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Query_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."_KeywordToQuery" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_KeywordToQuery_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_QueryToSource" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_QueryToSource_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Query_name_key" ON "public"."Query"("name");

-- CreateIndex
CREATE INDEX "_KeywordToQuery_B_index" ON "public"."_KeywordToQuery"("B");

-- CreateIndex
CREATE INDEX "_QueryToSource_B_index" ON "public"."_QueryToSource"("B");

-- AddForeignKey
ALTER TABLE "public"."_KeywordToQuery" ADD CONSTRAINT "_KeywordToQuery_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_KeywordToQuery" ADD CONSTRAINT "_KeywordToQuery_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."Query"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_QueryToSource" ADD CONSTRAINT "_QueryToSource_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Query"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_QueryToSource" ADD CONSTRAINT "_QueryToSource_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
