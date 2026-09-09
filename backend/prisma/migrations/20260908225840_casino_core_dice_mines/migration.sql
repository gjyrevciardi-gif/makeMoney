-- CreateEnum
CREATE TYPE "CasinoGameType" AS ENUM ('DICE', 'MINES', 'ROULETTE', 'BLACKJACK', 'CRASH', 'PLINKO', 'SLOTS');

-- CreateEnum
CREATE TYPE "CasinoRoundStatus" AS ENUM ('OPEN', 'WON', 'LOST', 'CASHED_OUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CasinoTransactionType" AS ENUM ('BET', 'WIN', 'REFUND');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CASINO_ROUND_STARTED';
ALTER TYPE "AuditAction" ADD VALUE 'CASINO_ROUND_WON';
ALTER TYPE "AuditAction" ADD VALUE 'CASINO_ROUND_LOST';
ALTER TYPE "AuditAction" ADD VALUE 'CASINO_CASHOUT';
ALTER TYPE "AuditAction" ADD VALUE 'CASINO_ROUND_SETTLED';
ALTER TYPE "AuditAction" ADD VALUE 'CASINO_ROUND_FAILED';

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "relatedCasinoRoundId" UUID;

-- CreateTable
CREATE TABLE "CasinoRound" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "gameType" "CasinoGameType" NOT NULL,
    "gameVersion" TEXT NOT NULL,
    "status" "CasinoRoundStatus" NOT NULL DEFAULT 'OPEN',
    "stake" BIGINT NOT NULL,
    "multiplier" DECIMAL(28,8),
    "payout" BIGINT NOT NULL DEFAULT 0,
    "serverSeed" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL DEFAULT 0,
    "publicState" JSONB NOT NULL,
    "privateState" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "CasinoRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CasinoRoundAction" (
    "id" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CasinoRoundAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CasinoTransaction" (
    "id" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "CasinoTransactionType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CasinoTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CasinoRound_idempotencyKey_key" ON "CasinoRound"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CasinoRound_userId_createdAt_idx" ON "CasinoRound"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CasinoRound_userId_gameType_status_createdAt_idx" ON "CasinoRound"("userId", "gameType", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CasinoRound_gameType_gameVersion_status_idx" ON "CasinoRound"("gameType", "gameVersion", "status");

-- CreateIndex
CREATE INDEX "CasinoRound_status_createdAt_idx" ON "CasinoRound"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CasinoRoundAction_idempotencyKey_key" ON "CasinoRoundAction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CasinoRoundAction_roundId_createdAt_idx" ON "CasinoRoundAction"("roundId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CasinoTransaction_idempotencyKey_key" ON "CasinoTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CasinoTransaction_roundId_idx" ON "CasinoTransaction"("roundId");

-- CreateIndex
CREATE INDEX "CasinoTransaction_userId_createdAt_idx" ON "CasinoTransaction"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_relatedCasinoRoundId_fkey" FOREIGN KEY ("relatedCasinoRoundId") REFERENCES "CasinoRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoRound" ADD CONSTRAINT "CasinoRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoRoundAction" ADD CONSTRAINT "CasinoRoundAction_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "CasinoRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoTransaction" ADD CONSTRAINT "CasinoTransaction_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "CasinoRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Casino point movement must always reference the round that justifies it, so a
-- casino credit can never be created without an auditable authoritative round.
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_casino_round_relation_check" CHECK (
  "type" NOT IN ('CASINO_BET', 'CASINO_WIN', 'CASINO_ROLLBACK_REFUND') OR "relatedCasinoRoundId" IS NOT NULL
);

-- Structural round invariants enforced by the database rather than by service code.
ALTER TABLE "CasinoRound" ADD CONSTRAINT "CasinoRound_stake_positive_check" CHECK ("stake" > 0);
ALTER TABLE "CasinoRound" ADD CONSTRAINT "CasinoRound_payout_nonnegative_check" CHECK ("payout" >= 0);
ALTER TABLE "CasinoRound" ADD CONSTRAINT "CasinoRound_lost_zero_payout_check" CHECK (
  "status" <> 'LOST' OR "payout" = 0
);
ALTER TABLE "CasinoRound" ADD CONSTRAINT "CasinoRound_open_unsettled_check" CHECK (
  ("status" = 'OPEN') = ("settledAt" IS NULL)
);
ALTER TABLE "CasinoTransaction" ADD CONSTRAINT "CasinoTransaction_amount_sign_check" CHECK (
  ("type" = 'BET' AND "amount" < 0) OR ("type" IN ('WIN', 'REFUND') AND "amount" > 0)
);
