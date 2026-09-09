CREATE TYPE "BetType" AS ENUM ('SINGLE', 'ACCUMULATOR');
CREATE TYPE "BetLegStatus" AS ENUM ('OPEN', 'WON', 'LOST', 'VOID');
ALTER TABLE "Bet" ADD COLUMN "type" "BetType" NOT NULL DEFAULT 'SINGLE', ADD COLUMN "totalOdds" DECIMAL(24,8) NOT NULL DEFAULT 1;
ALTER TABLE "BetLeg" ADD COLUMN "sportKey" TEXT NOT NULL DEFAULT 'unknown', ADD COLUMN "homeTeam" TEXT NOT NULL DEFAULT 'unknown', ADD COLUMN "awayTeam" TEXT NOT NULL DEFAULT 'unknown', ADD COLUMN "marketName" TEXT NOT NULL DEFAULT 'unknown', ADD COLUMN "selectionName" TEXT NOT NULL DEFAULT 'unknown', ADD COLUMN "status" "BetLegStatus" NOT NULL DEFAULT 'OPEN', ADD COLUMN "resultMetadata" JSONB, ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "Bet_userId_status_createdAt_idx" ON "Bet"("userId", "status", "createdAt");
CREATE INDEX "BetLeg_providerEventId_idx" ON "BetLeg"("providerEventId");
