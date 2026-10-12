-- Additive: per-user session invalidation counter. Existing rows start at 0,
-- which is the version stamped on tokens issued before this migration, so no
-- live session is disturbed until a logout or password change bumps it.
ALTER TABLE "User" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
