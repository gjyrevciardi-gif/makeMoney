-- Book of the Sands backend: authoritative session state and scoped request
-- ledger. Purely additive: no existing table, column, constraint or index is
-- touched, and no production database is migrated by this commit.

CREATE TABLE "BookOfRaSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "gameId" TEXT NOT NULL DEFAULT 'book-of-ra',
    "profileId" TEXT NOT NULL,
    "profileFingerprint" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'IDLE',
    "activeLines" INTEGER NOT NULL DEFAULT 10,
    "betPerLine" BIGINT NOT NULL DEFAULT 0,
    "totalBet" BIGINT NOT NULL DEFAULT 0,
    "specialSymbol" TEXT,
    "freeSpinsAwarded" INTEGER NOT NULL DEFAULT 0,
    "freeSpinsRemaining" INTEGER NOT NULL DEFAULT 0,
    "freeSpinsPlayed" INTEGER NOT NULL DEFAULT 0,
    "retriggerCount" INTEGER NOT NULL DEFAULT 0,
    "featureWin" BIGINT NOT NULL DEFAULT 0,
    "pendingWin" BIGINT NOT NULL DEFAULT 0,
    "pendingActionId" TEXT,
    "pendingRoundId" UUID,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookOfRaSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BookOfRaSession_userId_key" ON "BookOfRaSession"("userId");
CREATE INDEX "BookOfRaSession_gameId_phase_idx" ON "BookOfRaSession"("gameId", "phase");

ALTER TABLE "BookOfRaSession"
    ADD CONSTRAINT "BookOfRaSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CasinoRequestKey" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "gameId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "roundId" UUID,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CasinoRequestKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CasinoRequestKey_userId_gameId_operation_requestKey_key"
    ON "CasinoRequestKey"("userId", "gameId", "operation", "requestKey");
CREATE INDEX "CasinoRequestKey_userId_createdAt_idx" ON "CasinoRequestKey"("userId", "createdAt");
CREATE INDEX "CasinoRequestKey_roundId_idx" ON "CasinoRequestKey"("roundId");

ALTER TABLE "CasinoRequestKey"
    ADD CONSTRAINT "CasinoRequestKey_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
