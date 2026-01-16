-- AlterEnum
ALTER TYPE "public"."QueryFrequency" ADD VALUE 'CRONTAB';

-- AlterTable
ALTER TABLE "public"."Query" ADD COLUMN     "cronSchedule" TEXT;
