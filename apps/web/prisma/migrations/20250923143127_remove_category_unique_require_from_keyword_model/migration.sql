/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `Keyword` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."Keyword_name_categoryId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Keyword_name_key" ON "public"."Keyword"("name");
