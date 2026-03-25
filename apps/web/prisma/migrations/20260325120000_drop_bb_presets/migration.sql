-- DropForeignKey
ALTER TABLE "public"."SourcePresetBinding" DROP CONSTRAINT IF EXISTS "SourcePresetBinding_sourceId_fkey";
ALTER TABLE "public"."SourcePresetBinding" DROP CONSTRAINT IF EXISTS "SourcePresetBinding_presetId_fkey";

-- DropTable
DROP TABLE IF EXISTS "public"."SourcePresetBinding";

-- DropTable
DROP TABLE IF EXISTS "public"."BbPresetSyncLog";

-- DropTable
DROP TABLE IF EXISTS "public"."BbPreset";

-- DropEnum
DROP TYPE IF EXISTS "public"."BbPresetStatus";

-- DropEnum
DROP TYPE IF EXISTS "public"."BbPresetSyncStatus";
