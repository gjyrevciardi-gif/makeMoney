-- Explicit audit action for role demotion (previously recorded as ADMIN_ROLE_GRANTED).
--
-- Additive only: existing audit rows are untouched and keep their original action.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADMIN_ROLE_REVOKED';
