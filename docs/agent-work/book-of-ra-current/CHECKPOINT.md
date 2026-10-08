# Book of Ra Classic checkpoint (wallet/replay/recovery, correction cycle 1)

PAID DEBIT: PASS - one CASINO_BET, -18 for 2x9, matching wallet/ledger delta
WIN CREDIT: PASS - paid win collected once; same-key repeat returns stored JSON, still one credit
FREE SPIN DEBIT: PASS - ten free games, no new CASINO_BET (cycle 0, unchanged)
IDENTICAL REPLAY: PASS - stored-JSON equality with the database payload, no redraw, one action row
CHANGED REQUEST: PASS - same id + different semantics -> IDEMPOTENCY_KEY_CONFLICT (cycle 0)
RECOVERY: PASS - restores round/phase/free/expanding symbol/pending after mid-feature AND after completion+collect reloads
NO REDRAW: PASS - baseline now AFTER preparation (>0); rng unchanged through reconciliation; prepared rows 1 -> 0
LEDGER RECONCILIATION: PASS - both deltas compared; ledgerSum === balance
CONCURRENCY: FAIL (open) - duplicate collect PASS; duplicate debit loser returns an unmapped storage error, not a documented conflict
BUG FOUND: 1 unresolved runtime race-mapping gap (concurrent debit loser); 6 defects were in this agent's own first-pass assertions
FIX: none applied - the one permitted minimal fix was not used (would change shared journal/runtime)
FILES: backend/test/book-of-ra-classic.wallet-replay-recovery.spec.ts, docs/agent-work/book-of-ra-current/WALLET-REPLAY-RECOVERY.md
TESTS: corrected jest filter (4 of 5 selected) exit 1; boc_classic_test 127.0.0.1:55432 (project gat-p0) only
STATUS: NOT ACCEPTED - one unresolved material failure (concurrent debit race)
NEXT STEP: Astra decides on mapping the concurrent-debit race in the shared journal; then rerun this filter
