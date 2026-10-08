-- New enum values only. They are used by the next migration, never in this one.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MANAGER';
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'TRANSFER_IN';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'PTS_TRANSFERRED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'PTS_RECLAIMED';

-- The administrator one level above the owner (a manager's administrator), so an ADMIN sees events
-- about the players of the managers they created.
ALTER TABLE "SecurityEvent" ADD COLUMN "topOwnerId" UUID;
CREATE INDEX "SecurityEvent_topOwnerId_createdAt_idx" ON "SecurityEvent"("topOwnerId", "createdAt");
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_topOwnerId_fkey" FOREIGN KEY ("topOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
