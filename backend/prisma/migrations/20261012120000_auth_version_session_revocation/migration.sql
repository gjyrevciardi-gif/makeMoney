-- Additive: per-user authentication version. Existing rows start at 0.
-- Legacy access JWTs lack the version claim (av) and are rejected by the updated
-- backend; clients must refresh with a valid refresh token or log in again.
-- Deployment order: apply this migration before deploying the updated backend.
ALTER TABLE "User" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
