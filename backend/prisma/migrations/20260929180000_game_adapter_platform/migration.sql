-- Rename the per-game capability tables into the shared game-integration layer
-- and add the one column the shared prepared-outcome journal needs to scope a
-- player's pending settlements by game.
--
-- This migration is rename-only plus one nullable column that is immediately
-- backfilled, so no data is transformed and no existing row is lost. The
-- columns themselves are unchanged: the same launch, session and prepared
-- outcome rows stay exactly where they are, and the first-party games are
-- untouched because they never used these tables.

ALTER TABLE "LuckyLadyLaunch" RENAME TO "GameLaunchCapability";
ALTER TABLE "LuckyLadySession" RENAME TO "GameSession";
ALTER TABLE "LuckyLadyPrepared" RENAME TO "GamePreparedOutcome";

ALTER TABLE "GamePreparedOutcome" ADD COLUMN "gameId" TEXT;
UPDATE "GamePreparedOutcome" SET "gameId" = 'lucky-lady' WHERE "gameId" IS NULL;
ALTER TABLE "GamePreparedOutcome" ALTER COLUMN "gameId" SET NOT NULL;

-- Index and constraint names follow the models, so a schema diff stays clean.
ALTER INDEX "LuckyLadyLaunch_pkey" RENAME TO "GameLaunchCapability_pkey";
ALTER INDEX "LuckyLadyLaunch_tokenHash_key" RENAME TO "GameLaunchCapability_tokenHash_key";
ALTER INDEX "LuckyLadyLaunch_userId_createdAt_idx" RENAME TO "GameLaunchCapability_userId_createdAt_idx";
ALTER INDEX "LuckyLadyLaunch_expiresAt_idx" RENAME TO "GameLaunchCapability_expiresAt_idx";
ALTER INDEX "LuckyLadySession_pkey" RENAME TO "GameSession_pkey";
ALTER INDEX "LuckyLadySession_tokenHash_key" RENAME TO "GameSession_tokenHash_key";
ALTER INDEX "LuckyLadySession_userId_gameId_createdAt_idx" RENAME TO "GameSession_userId_gameId_createdAt_idx";
ALTER INDEX "LuckyLadySession_expiresAt_idx" RENAME TO "GameSession_expiresAt_idx";
ALTER INDEX "LuckyLadyPrepared_pkey" RENAME TO "GamePreparedOutcome_pkey";
ALTER INDEX "LuckyLadyPrepared_requestKey_key" RENAME TO "GamePreparedOutcome_requestKey_key";
ALTER INDEX "LuckyLadyPrepared_userId_createdAt_idx" RENAME TO "GamePreparedOutcome_userId_createdAt_idx";

CREATE INDEX "GamePreparedOutcome_gameId_createdAt_idx" ON "GamePreparedOutcome"("gameId", "createdAt");

ALTER TABLE "GameLaunchCapability"
  RENAME CONSTRAINT "LuckyLadyLaunch_userId_fkey" TO "GameLaunchCapability_userId_fkey";
ALTER TABLE "GameSession"
  RENAME CONSTRAINT "LuckyLadySession_userId_fkey" TO "GameSession_userId_fkey";
ALTER TABLE "GamePreparedOutcome"
  RENAME CONSTRAINT "LuckyLadyPrepared_userId_fkey" TO "GamePreparedOutcome_userId_fkey";
