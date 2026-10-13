-- Durable terminal cancellation for prepared game outcomes.
--
-- A prepared outcome refused because the game session that produced it was
-- retired (all-devices logout, password change, account disable) can never
-- settle. It is retained and marked here instead of being deleted: the request
-- identity, the canonical semantics and the outcome that was already drawn
-- stay durable, so that key can never be prepared - and therefore never
-- redrawn - again, while the row stops blocking unrelated actions.
--
-- NULL means the outcome is still pending and settles exactly as before.
ALTER TABLE "GamePreparedOutcome" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "GamePreparedOutcome" ADD COLUMN "cancelledReason" TEXT;
