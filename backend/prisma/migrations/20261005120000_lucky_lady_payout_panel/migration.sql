-- Admin RTP Control panel: additive payout-policy lifecycle persistence.
--
-- One new audit action code covers the payout lifecycle (every row records the
-- specific GENERATE/PREVIEW/ACTIVATE/ROLLBACK/DEFAULT action in its metadata).
-- GameActiveMathProfile gains a `kind` and a nullable profile row so an explicit
-- restore-to-default keeps its monotonic revision as a tombstone instead of
-- deleting and recreating the pointer at version 1.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'CASINO_MATH_PAYOUT_LIFECYCLE';

-- AlterTable
ALTER TABLE "GameActiveMathProfile"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'GENERATED',
  ADD COLUMN "payoutCandidateId" TEXT,
  ALTER COLUMN "profileRowId" DROP NOT NULL,
  ALTER COLUMN "validationId" DROP NOT NULL;

-- DropForeignKey
ALTER TABLE "GameActiveMathProfile"
  DROP CONSTRAINT "GameActiveMathProfile_profileRowId_fkey";

-- AddForeignKey
ALTER TABLE "GameActiveMathProfile"
  ADD CONSTRAINT "GameActiveMathProfile_profileRowId_fkey"
  FOREIGN KEY ("profileRowId") REFERENCES "GameMathProfile"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "LuckyLadyPayoutCandidate" (
    "id" UUID NOT NULL,
    "gameId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "requestHash" TEXT,
    "policyHash" TEXT NOT NULL,
    "modelHash" TEXT NOT NULL,
    "modelProfileId" TEXT NOT NULL,
    "declaredReturnPercent" DECIMAL(9,4) NOT NULL,
    "targetRtpPercent" DECIMAL(9,4) NOT NULL,
    "maxWinMultiplier" INTEGER NOT NULL,
    "style" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "distributionPolicy" JSONB NOT NULL,
    "modelArtifact" JSONB NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LuckyLadyPayoutCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LuckyLadyPayoutValidation" (
    "id" UUID NOT NULL,
    "candidateRowId" UUID NOT NULL,
    "gameId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "policyHash" TEXT NOT NULL,
    "modelHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "artifactPath" TEXT NOT NULL,
    "validatedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LuckyLadyPayoutValidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LuckyLadyPayoutActivation" (
    "id" UUID NOT NULL,
    "gameId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "candidateRowId" UUID,
    "candidateId" TEXT,
    "modelProfileId" TEXT,
    "policyHash" TEXT,
    "modelHash" TEXT,
    "targetRtpPercent" DECIMAL(9,4),
    "maxWinMultiplier" INTEGER,
    "style" TEXT,
    "version" INTEGER NOT NULL,
    "previous" JSONB NOT NULL,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LuckyLadyPayoutActivation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LuckyLadyPayoutCandidate_gameId_candidateId_key" ON "LuckyLadyPayoutCandidate"("gameId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "LuckyLadyPayoutCandidate_gameId_policyHash_key" ON "LuckyLadyPayoutCandidate"("gameId", "policyHash");

-- CreateIndex
CREATE INDEX "LuckyLadyPayoutCandidate_gameId_createdAt_idx" ON "LuckyLadyPayoutCandidate"("gameId", "createdAt");

-- CreateIndex
CREATE INDEX "LuckyLadyPayoutCandidate_modelHash_idx" ON "LuckyLadyPayoutCandidate"("modelHash");

-- CreateIndex
CREATE INDEX "LuckyLadyPayoutValidation_candidateRowId_createdAt_idx" ON "LuckyLadyPayoutValidation"("candidateRowId", "createdAt");

-- CreateIndex
CREATE INDEX "LuckyLadyPayoutValidation_gameId_candidateId_createdAt_idx" ON "LuckyLadyPayoutValidation"("gameId", "candidateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LuckyLadyPayoutActivation_gameId_actionId_key" ON "LuckyLadyPayoutActivation"("gameId", "actionId");

-- CreateIndex
CREATE INDEX "LuckyLadyPayoutActivation_gameId_createdAt_idx" ON "LuckyLadyPayoutActivation"("gameId", "createdAt");

-- AddForeignKey
ALTER TABLE "LuckyLadyPayoutValidation"
  ADD CONSTRAINT "LuckyLadyPayoutValidation_candidateRowId_fkey"
  FOREIGN KEY ("candidateRowId") REFERENCES "LuckyLadyPayoutCandidate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LuckyLadyPayoutActivation"
  ADD CONSTRAINT "LuckyLadyPayoutActivation_candidateRowId_fkey"
  FOREIGN KEY ("candidateRowId") REFERENCES "LuckyLadyPayoutCandidate"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
