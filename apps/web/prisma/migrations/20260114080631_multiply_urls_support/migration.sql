/*
  Warnings:

  - The `url` column on the `DarknetSourceConfig` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `url` column on the `WebSourceConfig` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "DarknetSourceConfig" DROP COLUMN "url",
ADD COLUMN     "url" TEXT[];

-- AlterTable
ALTER TABLE "WebSourceConfig" DROP COLUMN "url",
ADD COLUMN     "url" TEXT[];
