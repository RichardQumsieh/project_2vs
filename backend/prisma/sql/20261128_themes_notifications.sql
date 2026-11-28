-- Themes, gallery, and E2EE-safe push devices.
-- This repo applies schema changes with `npx prisma db push`.
-- The statements below match backend/prisma/schema.prisma for operators who apply SQL directly.

CREATE TABLE IF NOT EXISTS "ThemeRecord" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "tokens" JSONB NOT NULL,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "flagged" BOOLEAN NOT NULL DEFAULT false,
  "likeCount" INTEGER NOT NULL DEFAULT 0,
  "sourceThemeId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ThemeRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ThemeLike" (
  "themeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ThemeLike_pkey" PRIMARY KEY ("themeId", "userId")
);

CREATE TABLE IF NOT EXISTS "ThemeReport" (
  "id" TEXT NOT NULL,
  "themeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ThemeReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ThemeApplication" (
  "userId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL DEFAULT '',
  "themeId" TEXT NOT NULL,
  "wallpaperOnly" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ThemeApplication_pkey" PRIMARY KEY ("userId", "scope", "conversationId")
);

CREATE TABLE IF NOT EXISTS "PushDevice" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "keys" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "NotificationPreference" (
  "userId" TEXT NOT NULL,
  "hidePreviews" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE IF NOT EXISTS "ConversationMute" (
  "userId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "mutedUntil" TIMESTAMP(3),
  CONSTRAINT "ConversationMute_pkey" PRIMARY KEY ("userId", "conversationId")
);

CREATE TABLE IF NOT EXISTS "NotificationState" (
  "userId" TEXT NOT NULL,
  "badgeCount" INTEGER NOT NULL DEFAULT 0,
  "openConversationId" TEXT,
  "openUntil" TIMESTAMP(3),
  "foregroundUntil" TIMESTAMP(3),
  CONSTRAINT "NotificationState_pkey" PRIMARY KEY ("userId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ThemeReport_themeId_userId_key" ON "ThemeReport"("themeId", "userId");
CREATE INDEX IF NOT EXISTS "ThemeRecord_ownerUserId_updatedAt_idx" ON "ThemeRecord"("ownerUserId", "updatedAt");
CREATE INDEX IF NOT EXISTS "ThemeRecord_published_flagged_likeCount_idx" ON "ThemeRecord"("published", "flagged", "likeCount");
CREATE INDEX IF NOT EXISTS "ThemeApplication_themeId_idx" ON "ThemeApplication"("themeId");
CREATE UNIQUE INDEX IF NOT EXISTS "PushDevice_userId_token_key" ON "PushDevice"("userId", "token");
CREATE INDEX IF NOT EXISTS "PushDevice_userId_revokedAt_idx" ON "PushDevice"("userId", "revokedAt");

DO $$ BEGIN
  ALTER TABLE "ThemeRecord" ADD CONSTRAINT "ThemeRecord_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ThemeLike" ADD CONSTRAINT "ThemeLike_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "ThemeRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ThemeLike" ADD CONSTRAINT "ThemeLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ThemeReport" ADD CONSTRAINT "ThemeReport_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "ThemeRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ThemeReport" ADD CONSTRAINT "ThemeReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ThemeApplication" ADD CONSTRAINT "ThemeApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ThemeApplication" ADD CONSTRAINT "ThemeApplication_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "ThemeRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ConversationMute" ADD CONSTRAINT "ConversationMute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "NotificationState" ADD CONSTRAINT "NotificationState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
