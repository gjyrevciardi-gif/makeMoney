ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_OWNER_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SECURITY_EVENT_ACKNOWLEDGED';

CREATE TYPE "SecurityEventType" AS ENUM ('PTS_GRANTED', 'PTS_REMOVED', 'BIG_WIN', 'HUGE_WIN');
CREATE TYPE "SecuritySeverity" AS ENUM ('INFO', 'WARNING', 'ALERT');

CREATE TABLE "SecurityEvent" (
    "id" UUID NOT NULL,
    "type" "SecurityEventType" NOT NULL,
    "severity" "SecuritySeverity" NOT NULL,
    "subjectUserId" UUID NOT NULL,
    "actorId" UUID,
    "ownerAdminId" UUID,
    "amount" BIGINT NOT NULL,
    "balanceAfter" BIGINT,
    "reason" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" UUID,
    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SecurityEvent_createdAt_idx" ON "SecurityEvent"("createdAt");
CREATE INDEX "SecurityEvent_ownerAdminId_createdAt_idx" ON "SecurityEvent"("ownerAdminId", "createdAt");
CREATE INDEX "SecurityEvent_subjectUserId_createdAt_idx" ON "SecurityEvent"("subjectUserId", "createdAt");
CREATE INDEX "SecurityEvent_acknowledgedAt_idx" ON "SecurityEvent"("acknowledgedAt");

ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_ownerAdminId_fkey" FOREIGN KEY ("ownerAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
