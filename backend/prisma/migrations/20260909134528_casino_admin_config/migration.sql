-- CreateEnum
CREATE TYPE "CasinoConfigStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CASINO_CONFIG_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CASINO_CONFIG_ACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'CASINO_GAME_ENABLED';
ALTER TYPE "AuditAction" ADD VALUE 'CASINO_GAME_DISABLED';
ALTER TYPE "AuditAction" ADD VALUE 'CASINO_MAINTENANCE_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'PLATFORM_MAINTENANCE_CHANGED';

-- CreateTable
CREATE TABLE "CasinoGameConfig" (
    "id" UUID NOT NULL,
    "gameId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "maintenance" BOOLEAN NOT NULL DEFAULT false,
    "activeVersionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CasinoGameConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CasinoGameConfigVersion" (
    "id" UUID NOT NULL,
    "gameConfigId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "status" "CasinoConfigStatus" NOT NULL DEFAULT 'DRAFT',
    "minStake" BIGINT NOT NULL,
    "maxStake" BIGINT NOT NULL,
    "rtpBps" INTEGER,
    "gameSpecificConfig" JSONB NOT NULL,
    "createdByAdminId" UUID,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "CasinoGameConfigVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "casinoMaintenance" BOOLEAN NOT NULL DEFAULT false,
    "sportsbookMaintenance" BOOLEAN NOT NULL DEFAULT false,
    "updatedByAdminId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CasinoGameConfig_gameId_key" ON "CasinoGameConfig"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "CasinoGameConfig_activeVersionId_key" ON "CasinoGameConfig"("activeVersionId");

-- CreateIndex
CREATE INDEX "CasinoGameConfigVersion_gameConfigId_status_idx" ON "CasinoGameConfigVersion"("gameConfigId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CasinoGameConfigVersion_gameConfigId_version_key" ON "CasinoGameConfigVersion"("gameConfigId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CasinoGameConfigVersion_gameConfigId_label_key" ON "CasinoGameConfigVersion"("gameConfigId", "label");

-- AddForeignKey
ALTER TABLE "CasinoGameConfig" ADD CONSTRAINT "CasinoGameConfig_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "CasinoGameConfigVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoGameConfigVersion" ADD CONSTRAINT "CasinoGameConfigVersion_gameConfigId_fkey" FOREIGN KEY ("gameConfigId") REFERENCES "CasinoGameConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoGameConfigVersion" ADD CONSTRAINT "CasinoGameConfigVersion_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Structural invariants for operator-supplied configuration.
ALTER TABLE "CasinoGameConfigVersion" ADD CONSTRAINT "CasinoGameConfigVersion_version_positive_check"
  CHECK ("version" > 0);
ALTER TABLE "CasinoGameConfigVersion" ADD CONSTRAINT "CasinoGameConfigVersion_stake_bounds_check"
  CHECK ("minStake" > 0 AND "maxStake" >= "minStake");
ALTER TABLE "CasinoGameConfigVersion" ADD CONSTRAINT "CasinoGameConfigVersion_rtp_range_check"
  CHECK ("rtpBps" IS NULL OR ("rtpBps" >= 5000 AND "rtpBps" <= 9950));

-- A configuration version's mathematics is immutable once written. Only the
-- lifecycle columns may move (DRAFT -> ACTIVE -> SUPERSEDED); every number a
-- settled round depends on is frozen, so historical rounds stay verifiable
-- even after an operator activates something different.
CREATE FUNCTION reject_casino_config_mutation() RETURNS trigger AS $$
BEGIN
  IF NEW."gameConfigId" IS DISTINCT FROM OLD."gameConfigId"
     OR NEW."version" IS DISTINCT FROM OLD."version"
     OR NEW."label" IS DISTINCT FROM OLD."label"
     OR NEW."minStake" IS DISTINCT FROM OLD."minStake"
     OR NEW."maxStake" IS DISTINCT FROM OLD."maxStake"
     OR NEW."rtpBps" IS DISTINCT FROM OLD."rtpBps"
     OR NEW."gameSpecificConfig" IS DISTINCT FROM OLD."gameSpecificConfig"
     OR NEW."createdByAdminId" IS DISTINCT FROM OLD."createdByAdminId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'CasinoGameConfigVersion mathematics is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CasinoGameConfigVersion_reject_math_update"
BEFORE UPDATE ON "CasinoGameConfigVersion"
FOR EACH ROW EXECUTE FUNCTION reject_casino_config_mutation();
