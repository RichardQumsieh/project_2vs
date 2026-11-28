-- Incremental profile columns for existing databases.
-- `npx prisma db push` applies the same change from schema.prisma.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarConfig" JSONB;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "greetingText" VARCHAR(80);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "greetingAnimation" VARCHAR(16);
