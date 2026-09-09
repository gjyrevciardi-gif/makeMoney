-- Point creation is closed by default: only the explicitly listed credit event
-- types may carry positive amounts, and only listed debit types may be negative.
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_type_amount_check" CHECK (
  ("amount" > 0 AND "type" IN ('ADMIN_GRANT', 'SPORTS_WIN', 'CASINO_WIN', 'BET_VOID_REFUND', 'CASINO_ROLLBACK_REFUND'))
  OR
  ("amount" < 0 AND "type" IN ('SPORTS_BET', 'CASINO_BET', 'ADMIN_REMOVE'))
);

ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_admin_actor_check" CHECK (
  "type" NOT IN ('ADMIN_GRANT', 'ADMIN_REMOVE') OR "actorId" IS NOT NULL
);

ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_sports_bet_relation_check" CHECK (
  "type" NOT IN ('SPORTS_BET', 'SPORTS_WIN', 'BET_VOID_REFUND') OR "relatedBetId" IS NOT NULL
);

ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_nonnegative_balance_check" CHECK ("balance" >= 0);
