-- Allow social platforms beyond predefined enum values.
ALTER TABLE "public"."SocialMediaSourceConfig"
ALTER COLUMN "platform" TYPE TEXT
USING "platform"::TEXT;

DROP TYPE "public"."SocialPlatform";
