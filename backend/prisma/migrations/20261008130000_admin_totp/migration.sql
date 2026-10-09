ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MFA_ENABLED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MFA_RECOVERY_USED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MFA_LOGIN_FAILED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MFA_RESET';

CREATE TABLE "UserTotp" (
    "userId" UUID NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "enabledAt" TIMESTAMP(3),
    "lastStep" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserTotp_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "UserRecoveryCode" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserRecoveryCode_userId_usedAt_idx" ON "UserRecoveryCode"("userId", "usedAt");

ALTER TABLE "UserTotp" ADD CONSTRAINT "UserTotp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserRecoveryCode" ADD CONSTRAINT "UserRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
