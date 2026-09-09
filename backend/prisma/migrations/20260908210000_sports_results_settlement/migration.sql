ALTER TYPE "AuditAction" ADD VALUE 'SPORTS_RESULT_RECEIVED';
ALTER TYPE "AuditAction" ADD VALUE 'BET_LEG_SETTLED';
ALTER TYPE "AuditAction" ADD VALUE 'SPORTS_RESULT_CONFLICT';
ALTER TYPE "AuditAction" ADD VALUE 'SPORTS_SETTLEMENT_FAILED';
CREATE TYPE "SportsResultStatus" AS ENUM ('FINAL', 'CANCELLED', 'POSTPONED', 'UNKNOWN');
ALTER TABLE "Bet" ADD COLUMN "finalOdds" DECIMAL(24,8), ADD COLUMN "actualPayout" BIGINT;
ALTER TABLE "BetLeg" ADD COLUMN "marketPoint" DECIMAL(12,4), ADD COLUMN "finalHomeScore" INTEGER, ADD COLUMN "finalAwayScore" INTEGER;
CREATE TABLE "SportsEventResult" (
  "id" UUID NOT NULL, "provider" TEXT NOT NULL, "providerEventId" TEXT NOT NULL,
  "status" "SportsResultStatus" NOT NULL, "homeScore" INTEGER, "awayScore" INTEGER,
  "completedAt" TIMESTAMP(3), "rawResultHash" TEXT, "metadata" JSONB,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SportsEventResult_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SportsEventResult_provider_providerEventId_key" ON "SportsEventResult"("provider", "providerEventId");
CREATE INDEX "SportsEventResult_status_updatedAt_idx" ON "SportsEventResult"("status", "updatedAt");
