CREATE TABLE "public"."SourceIdentity" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "type" "public"."SourceType" NOT NULL,
  "platform" TEXT NOT NULL,
  "driver" TEXT NOT NULL,
  "intentType" TEXT NOT NULL,
  "intentArgsHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SourceIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SourceIdentity_sourceId_key" ON "public"."SourceIdentity"("sourceId");
CREATE UNIQUE INDEX "SourceIdentity_type_platform_driver_intentType_intentArgsHash_key"
  ON "public"."SourceIdentity"("type", "platform", "driver", "intentType", "intentArgsHash");
CREATE INDEX "SourceIdentity_type_platform_driver_intentType_idx"
  ON "public"."SourceIdentity"("type", "platform", "driver", "intentType");

ALTER TABLE "public"."SourceIdentity"
ADD CONSTRAINT "SourceIdentity_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "public"."Source"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
