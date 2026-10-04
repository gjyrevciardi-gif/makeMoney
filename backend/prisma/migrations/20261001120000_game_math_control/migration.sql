-- Game Math Control: immutable per-game mathematics profiles, their append-only
-- validation evidence, and the durable per-game active pointer.
--
-- Additive only. No existing table, row, index or constraint is touched, so the
-- accepted Lucky Lady RTP50 profile (and every other game's mathematics) keeps
-- running exactly as it does today. A profile that has never been validated
-- cannot be activated: the pointer row carries the validation it was activated
-- against.

-- AlterEnum (additive; existing audit rows keep their values)
ALTER TYPE "AuditAction" ADD VALUE 'CASINO_MATH_PROFILE_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE 'CASINO_MATH_PROFILE_VALIDATED';
ALTER TYPE "AuditAction" ADD VALUE 'CASINO_MATH_PROFILE_ACTIVATED';

-- CreateTable
CREATE TABLE "GameMathProfile" (
    "id" UUID NOT NULL,
    "gameId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "canonicalHash" TEXT NOT NULL,
    "engineSha256" TEXT NOT NULL,
    "rulesSha256" TEXT NOT NULL,
    "targetRtpPercent" DECIMAL(9,4) NOT NULL,
    "measuredRtpPercent" DECIMAL(9,4),
    "maxWinMultiplier" DECIMAL(20,4) NOT NULL,
    "policy" JSONB NOT NULL,
    "analytic" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "generatedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameMathProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameMathProfileValidation" (
    "id" UUID NOT NULL,
    "profileRowId" UUID NOT NULL,
    "gameId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "profileHash" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "bankroll" JSONB NOT NULL,
    "checks" JSONB NOT NULL,
    "runs" JSONB NOT NULL,
    "artifactPath" TEXT NOT NULL,
    "validatedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameMathProfileValidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameActiveMathProfile" (
    "gameId" TEXT NOT NULL,
    "profileRowId" UUID NOT NULL,
    "profileId" TEXT NOT NULL,
    "profileHash" TEXT NOT NULL,
    "validationId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "activatedBy" UUID NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameActiveMathProfile_pkey" PRIMARY KEY ("gameId")
);

-- CreateIndex
CREATE INDEX "GameMathProfile_gameId_createdAt_idx" ON "GameMathProfile"("gameId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GameMathProfile_gameId_profileId_key" ON "GameMathProfile"("gameId", "profileId");

-- CreateIndex
CREATE UNIQUE INDEX "GameMathProfile_gameId_canonicalHash_key" ON "GameMathProfile"("gameId", "canonicalHash");

-- CreateIndex
CREATE INDEX "GameMathProfileValidation_profileRowId_createdAt_idx" ON "GameMathProfileValidation"("profileRowId", "createdAt");

-- CreateIndex
CREATE INDEX "GameMathProfileValidation_gameId_profileId_createdAt_idx" ON "GameMathProfileValidation"("gameId", "profileId", "createdAt");

-- CreateIndex
CREATE INDEX "GameActiveMathProfile_profileId_idx" ON "GameActiveMathProfile"("profileId");

-- AddForeignKey
ALTER TABLE "GameMathProfileValidation" ADD CONSTRAINT "GameMathProfileValidation_profileRowId_fkey" FOREIGN KEY ("profileRowId") REFERENCES "GameMathProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameActiveMathProfile" ADD CONSTRAINT "GameActiveMathProfile_profileRowId_fkey" FOREIGN KEY ("profileRowId") REFERENCES "GameMathProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
