ALTER TYPE "AuditAction" RENAME VALUE 'LOGIN' TO 'LOGIN_SUCCESS';
ALTER TYPE "AuditAction" ADD VALUE 'REFRESH_SUCCESS';
ALTER TYPE "AuditAction" ADD VALUE 'REFRESH_REUSE_DETECTED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_COIN_ADJUSTMENT';

ALTER TABLE "Session" RENAME TO "RefreshToken";
ALTER TABLE "RefreshToken" RENAME CONSTRAINT "Session_pkey" TO "RefreshToken_pkey";
ALTER TABLE "RefreshToken" RENAME CONSTRAINT "Session_userId_fkey" TO "RefreshToken_userId_fkey";
DROP INDEX "Session_userId_idx";
ALTER TABLE "RefreshToken" ADD COLUMN "familyId" UUID;
UPDATE "RefreshToken" SET "familyId" = gen_random_uuid() WHERE "familyId" IS NULL;
ALTER TABLE "RefreshToken" ALTER COLUMN "familyId" SET NOT NULL;
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_userId_createdAt_idx" ON "RefreshToken"("userId", "createdAt");
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

ALTER TABLE "AuditLog" ADD COLUMN "targetType" TEXT;
ALTER TABLE "AuditLog" ALTER COLUMN "targetId" TYPE TEXT USING "targetId"::TEXT;
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
CREATE INDEX "AuditLog_targetId_createdAt_idx" ON "AuditLog"("targetId", "createdAt");

CREATE FUNCTION reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AuditLog_reject_update_delete"
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
