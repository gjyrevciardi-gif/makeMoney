-- Username accounts, admin-created users, and the encrypted password vault.
--
-- Additive: existing users keep their email, password hash, role and history.
-- `email` becomes optional (a unique index still allows many NULLs), so accounts
-- can be identified by `username` alone. No row is rewritten or deleted.

-- AlterEnum (new audit actions; existing audit rows are untouched)
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSWORD_SET_BY_ADMIN';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSWORD_REVEALED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSWORD_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_USERNAME_CHANGED';

-- AlterTable
ALTER TABLE "User"
  ALTER COLUMN "email" DROP NOT NULL,
  ADD COLUMN "username" TEXT,
  ADD COLUMN "createdById" UUID;

-- A username is stored lowercase and limited to a safe character set, so lookups
-- never depend on case folding and a name can never contain whitespace or markup.
ALTER TABLE "User"
  ADD CONSTRAINT "User_username_format"
  CHECK ("username" IS NULL OR ("username" = lower("username") AND "username" ~ '^[a-z0-9._-]{3,32}$'));

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- AddForeignKey (never a cascading delete: removing an admin must not remove the accounts they created)
ALTER TABLE "User"
  ADD CONSTRAINT "User_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "UserPasswordVault" (
    "userId" UUID NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "UserPasswordVault_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey (the vault row is derived secret material owned by the user; it goes with the account)
ALTER TABLE "UserPasswordVault"
  ADD CONSTRAINT "UserPasswordVault_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
