-- Hierarchical RBAC: add the SUPER_ADMIN role and an account-disabled status.
--
-- Additive only. Existing users keep their current role and default to enabled.
-- No user is promoted: SUPER_ADMIN is granted only through an explicit,
-- audited bootstrap or admin action.

-- AlterEnum
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADMIN_USER_STATUS_CHANGED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "disabled" BOOLEAN NOT NULL DEFAULT false;
