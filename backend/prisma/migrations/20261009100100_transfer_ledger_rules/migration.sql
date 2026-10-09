-- Point creation stays closed. A transfer moves existing points between two wallets: it is an
-- entry of each sign, always attributable to the manager who made it.
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_type_amount_check";
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_type_amount_check" CHECK (
  ("amount" > 0 AND "type" IN ('ADMIN_GRANT', 'SPORTS_WIN', 'CASINO_WIN', 'BET_VOID_REFUND', 'CASINO_ROLLBACK_REFUND', 'TRANSFER_IN'))
  OR
  ("amount" < 0 AND "type" IN ('SPORTS_BET', 'CASINO_BET', 'ADMIN_REMOVE', 'TRANSFER_OUT'))
);

ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_admin_actor_check";
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_admin_actor_check" CHECK (
  "type" NOT IN ('ADMIN_GRANT', 'ADMIN_REMOVE', 'TRANSFER_IN', 'TRANSFER_OUT') OR "actorId" IS NOT NULL
);
