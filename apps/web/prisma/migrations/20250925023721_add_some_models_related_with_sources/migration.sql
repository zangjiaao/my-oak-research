/*
  Warnings:

  - The values [RSS,RSSHUB,REDDIT,TELEGRAM,X,CUSTOM] on the enum `SourceType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `auth` on the `Source` table. All the data in the column will be lost.
  - You are about to drop the column `config` on the `Source` table. All the data in the column will be lost.
  - You are about to drop the column `headers` on the `Source` table. All the data in the column will be lost.
  - You are about to drop the column `url` on the `Source` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "public"."CrawlerEngine" AS ENUM ('FETCH', 'CHEERIO', 'PLAYWRIGHT', 'PUPPETEER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "public"."ProxyType" AS ENUM ('HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5', 'TOR');

-- CreateEnum
CREATE TYPE "public"."SearchEngineKind" AS ENUM ('GOOGLE', 'BING', 'DDG', 'SEARXNG', 'CUSTOM');

-- CreateEnum
CREATE TYPE "public"."SocialPlatform" AS ENUM ('X', 'TELEGRAM', 'REDDIT');

-- AlterEnum
BEGIN;
CREATE TYPE "public"."SourceType_new" AS ENUM ('WEB', 'DARKNET', 'SEARCH_ENGINE', 'SOCIAL_MEDIA');
ALTER TABLE "public"."Source" ALTER COLUMN "type" TYPE "public"."SourceType_new" USING ("type"::text::"public"."SourceType_new");
ALTER TYPE "public"."SourceType" RENAME TO "SourceType_old";
ALTER TYPE "public"."SourceType_new" RENAME TO "SourceType";
DROP TYPE "public"."SourceType_old";
COMMIT;

-- AlterTable
ALTER TABLE "public"."Source" DROP COLUMN "auth",
DROP COLUMN "config",
DROP COLUMN "headers",
DROP COLUMN "url",
ADD COLUMN     "credentialId" TEXT,
ADD COLUMN     "proxyId" TEXT;

-- CreateTable
CREATE TABLE "public"."Proxy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."ProxyType" NOT NULL,
    "url" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proxy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Credential" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WebSourceConfig" (
    "sourceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "headers" JSONB,
    "crawlerEngine" "public"."CrawlerEngine" NOT NULL DEFAULT 'FETCH',
    "render" BOOLEAN NOT NULL DEFAULT false,
    "parseRules" JSONB,
    "robotsRespect" BOOLEAN NOT NULL DEFAULT true,
    "proxyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebSourceConfig_pkey" PRIMARY KEY ("sourceId")
);

-- CreateTable
CREATE TABLE "public"."DarknetSourceConfig" (
    "sourceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "headers" JSONB,
    "crawlerEngine" "public"."CrawlerEngine" NOT NULL DEFAULT 'FETCH',
    "proxyId" TEXT NOT NULL,
    "render" BOOLEAN NOT NULL DEFAULT false,
    "parseRules" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DarknetSourceConfig_pkey" PRIMARY KEY ("sourceId")
);

-- CreateTable
CREATE TABLE "public"."SearchEngineSourceConfig" (
    "sourceId" TEXT NOT NULL,
    "engine" "public"."SearchEngineKind" NOT NULL,
    "query" TEXT NOT NULL,
    "region" TEXT,
    "lang" TEXT,
    "apiEndpoint" TEXT,
    "options" JSONB,
    "credentialId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchEngineSourceConfig_pkey" PRIMARY KEY ("sourceId")
);

-- CreateTable
CREATE TABLE "public"."SocialMediaSourceConfig" (
    "sourceId" TEXT NOT NULL,
    "platform" "public"."SocialPlatform" NOT NULL,
    "config" JSONB NOT NULL,
    "credentialId" TEXT,
    "proxyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialMediaSourceConfig_pkey" PRIMARY KEY ("sourceId")
);

-- AddForeignKey
ALTER TABLE "public"."Source" ADD CONSTRAINT "Source_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "public"."Proxy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Source" ADD CONSTRAINT "Source_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "public"."Credential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WebSourceConfig" ADD CONSTRAINT "WebSourceConfig_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "public"."Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WebSourceConfig" ADD CONSTRAINT "WebSourceConfig_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "public"."Proxy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DarknetSourceConfig" ADD CONSTRAINT "DarknetSourceConfig_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "public"."Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DarknetSourceConfig" ADD CONSTRAINT "DarknetSourceConfig_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "public"."Proxy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SearchEngineSourceConfig" ADD CONSTRAINT "SearchEngineSourceConfig_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "public"."Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SearchEngineSourceConfig" ADD CONSTRAINT "SearchEngineSourceConfig_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "public"."Credential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SocialMediaSourceConfig" ADD CONSTRAINT "SocialMediaSourceConfig_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "public"."Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SocialMediaSourceConfig" ADD CONSTRAINT "SocialMediaSourceConfig_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "public"."Credential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SocialMediaSourceConfig" ADD CONSTRAINT "SocialMediaSourceConfig_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "public"."Proxy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
