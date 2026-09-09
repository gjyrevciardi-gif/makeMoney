ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_EVENT_RECONCILIATION_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_EVENT_RECONCILIATION_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_CONFLICT_ACKNOWLEDGED';
CREATE TYPE "SettlementAttemptType" AS ENUM ('RESULT_FETCH', 'SETTLEMENT', 'ADMIN_RECONCILIATION');
CREATE TYPE "SettlementAttemptStatus" AS ENUM ('SUCCESS', 'FAILED', 'NO_RESULT', 'UNSUPPORTED', 'CONFLICT', 'RATE_LIMITED');
CREATE TABLE "SportsSettlementAttempt" (
  "id" UUID NOT NULL, "provider" TEXT NOT NULL, "providerEventId" TEXT NOT NULL,
  "betId" UUID, "betLegId" UUID, "attemptType" "SettlementAttemptType" NOT NULL,
  "status" "SettlementAttemptStatus" NOT NULL, "errorCode" TEXT, "errorMessageSafe" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL, "finishedAt" TIMESTAMP(3), "retryCount" INTEGER NOT NULL DEFAULT 0,
  "resolvedAt" TIMESTAMP(3), "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SportsSettlementAttempt_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SportsResultConflict" (
  "id" UUID NOT NULL, "provider" TEXT NOT NULL, "providerEventId" TEXT NOT NULL,
  "storedResult" JSONB NOT NULL, "conflictingResult" JSONB NOT NULL,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "acknowledgedBy" UUID,
  "acknowledgedAt" TIMESTAMP(3), "acknowledgementNote" TEXT,
  CONSTRAINT "SportsResultConflict_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SportsSettlementAttempt_status_createdAt_idx" ON "SportsSettlementAttempt"("status", "createdAt");
CREATE INDEX "SportsSettlementAttempt_provider_providerEventId_createdAt_idx" ON "SportsSettlementAttempt"("provider", "providerEventId", "createdAt");
CREATE INDEX "SportsSettlementAttempt_betId_idx" ON "SportsSettlementAttempt"("betId");
CREATE INDEX "SportsSettlementAttempt_errorCode_resolvedAt_createdAt_idx" ON "SportsSettlementAttempt"("errorCode", "resolvedAt", "createdAt");
CREATE INDEX "SportsResultConflict_provider_providerEventId_detectedAt_idx" ON "SportsResultConflict"("provider", "providerEventId", "detectedAt");
CREATE INDEX "SportsResultConflict_acknowledgedAt_detectedAt_idx" ON "SportsResultConflict"("acknowledgedAt", "detectedAt");
CREATE INDEX "BetLeg_status_provider_providerEventId_idx" ON "BetLeg"("status", "provider", "providerEventId");
CREATE INDEX "Bet_status_createdAt_idx" ON "Bet"("status", "createdAt");
CREATE INDEX "Bet_status_settledAt_idx" ON "Bet"("status", "settledAt");
CREATE INDEX "BetLeg_status_eventStartTime_idx" ON "BetLeg"("status", "eventStartTime");
ALTER TABLE "SportsResultConflict" ADD CONSTRAINT "SportsResultConflict_acknowledgedBy_fkey" FOREIGN KEY ("acknowledgedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
