-- Bind game credentials to the account session version.
--
-- Both columns are nullable on purpose. A credential minted before this
-- milestone has no version to compare against, so keeping the column NULL and
-- refusing NULL at every check makes every legacy credential fail closed
-- instead of silently surviving the rollout. Rows created after this migration
-- always carry the `User.authVersion` they were bound to.
ALTER TABLE "GameLaunchCapability" ADD COLUMN "authVersion" INTEGER;
ALTER TABLE "GameSession" ADD COLUMN "authVersion" INTEGER;

-- Deployment backfill for legacy rows: no credential issued before this
-- migration stays usable. Launch tickets are marked consumed rather than
-- deleted, and sessions are marked revoked, so no financial row is touched and
-- the history of what was issued stays intact.
UPDATE "GameLaunchCapability"
   SET "consumedAt" = now()
 WHERE "authVersion" IS NULL
   AND "consumedAt" IS NULL;

UPDATE "GameSession"
   SET "revokedAt" = now()
 WHERE "authVersion" IS NULL
   AND "revokedAt" IS NULL;
