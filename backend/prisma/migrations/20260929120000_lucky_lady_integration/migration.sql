-- Additive receipt/cache columns on the existing per-round action journal.
-- They stay null for the first-party games, which own their own replay
-- semantics; the imported game uses them as its durable response cache and
-- presentation-receipt journal.
ALTER TABLE "CasinoRoundAction" ADD COLUMN "gameId" TEXT;
ALTER TABLE "CasinoRoundAction" ADD COLUMN "canonical" TEXT;
ALTER TABLE "CasinoRoundAction" ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "CasinoRoundAction" ADD COLUMN "ackedAt" TIMESTAMP(3);

CREATE INDEX "CasinoRoundAction_userId_gameId_createdAt_idx" ON "CasinoRoundAction"("userId", "gameId", "createdAt");

-- One-time launch capability: only the hash of the opaque secret is stored.
CREATE TABLE "LuckyLadyLaunch" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "sessionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LuckyLadyLaunch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LuckyLadyLaunch_tokenHash_key" ON "LuckyLadyLaunch"("tokenHash");
CREATE INDEX "LuckyLadyLaunch_userId_createdAt_idx" ON "LuckyLadyLaunch"("userId", "createdAt");
CREATE INDEX "LuckyLadyLaunch_expiresAt_idx" ON "LuckyLadyLaunch"("expiresAt");

-- Reconnectable gameplay capability bound to one user and one game.
CREATE TABLE "LuckyLadySession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "gameId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LuckyLadySession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LuckyLadySession_tokenHash_key" ON "LuckyLadySession"("tokenHash");
CREATE INDEX "LuckyLadySession_userId_gameId_createdAt_idx" ON "LuckyLadySession"("userId", "gameId", "createdAt");
CREATE INDEX "LuckyLadySession_expiresAt_idx" ON "LuckyLadySession"("expiresAt");

-- Durable prepared-outcome journal: the authoritative result is committed here
-- before any wallet movement, so settlement can never reroll.
CREATE TABLE "LuckyLadyPrepared" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "requestKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "canonical" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "roundId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LuckyLadyPrepared_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LuckyLadyPrepared_requestKey_key" ON "LuckyLadyPrepared"("requestKey");
CREATE INDEX "LuckyLadyPrepared_userId_createdAt_idx" ON "LuckyLadyPrepared"("userId", "createdAt");

ALTER TABLE "LuckyLadyLaunch" ADD CONSTRAINT "LuckyLadyLaunch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LuckyLadySession" ADD CONSTRAINT "LuckyLadySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LuckyLadyPrepared" ADD CONSTRAINT "LuckyLadyPrepared_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
