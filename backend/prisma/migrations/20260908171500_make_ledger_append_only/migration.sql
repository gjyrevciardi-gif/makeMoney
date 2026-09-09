CREATE FUNCTION reject_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LedgerEntry is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerEntry_reject_update_delete"
BEFORE UPDATE OR DELETE ON "LedgerEntry"
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
