-- Additive provenance and ordering for the imported game.
--
-- Nothing here changes an existing column, so the first-party games keep their
-- exact current behaviour; the new columns stay null for them.

-- A database-generated monotonic order for the authoritative action journal, so
-- "the latest action" can never be decided by a random UUID tie-break.
ALTER TABLE "CasinoRoundAction" ADD COLUMN "seq" SERIAL NOT NULL;

-- Exact wallet before/after and the originating session/action on the one
-- authoritative ledger.
ALTER TABLE "LedgerEntry" ADD COLUMN "actionId" TEXT,
ADD COLUMN "balanceAfter" BIGINT,
ADD COLUMN "balanceBefore" BIGINT,
ADD COLUMN "gameSessionId" UUID;

-- The exact round state a durably prepared outcome was drawn against, plus the
-- session and action that produced it.
ALTER TABLE "LuckyLadyPrepared"
ADD COLUMN "actionId" TEXT,
ADD COLUMN "originPhase" TEXT,
ADD COLUMN "originRoundId" TEXT,
ADD COLUMN "originVersion" INTEGER,
ADD COLUMN "sessionId" UUID;

-- Backfill any prepared row written before this migration. The scoped request
-- key is "<userId>:<requestId>", so the action identity is its suffix.
UPDATE "LuckyLadyPrepared"
   SET "actionId" = substring("requestKey" from position(':' in "requestKey") + 1)
 WHERE "actionId" IS NULL
   AND position(':' in "requestKey") > 0;

UPDATE "LuckyLadyPrepared" SET "actionId" = "requestKey" WHERE "actionId" IS NULL;

ALTER TABLE "LuckyLadyPrepared" ALTER COLUMN "actionId" SET NOT NULL;

CREATE INDEX "CasinoRoundAction_userId_gameId_seq_idx" ON "CasinoRoundAction"("userId", "gameId", "seq");
