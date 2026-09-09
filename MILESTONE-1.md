# Milestone 1

The milestone flow is:

```text
REGISTER → CREATE USER → CREATE WALLET → BALANCE = 0 → LOGIN → DISPLAY 0 POINTS
→ ADMIN SECURELY GRANTS POINTS → USER CANNOT SELF-GRANT
→ SPORTS EVENTS AND ODDS → BET SLIP → BACKEND REVALIDATES ODDS
→ SIMULATED BET → SPORTS_BET LEDGER ENTRY → BET HISTORY
→ WON SETTLEMENT → SPORTS_WIN LEDGER ENTRY EXACTLY ONCE
```

Milestone 1 is not complete until tests prove all of the following:

- A new wallet has exactly zero points and registration creates no positive ledger entry.
- Repeated registration cannot create points.
- No welcome, registration, daily, or starting-balance bonus exists.
- Only `ADMIN_GRANT`, `SPORTS_WIN`, `CASINO_WIN`, `BET_VOID_REFUND`, and `CASINO_ROLLBACK_REFUND` may credit points.
- Only `SPORTS_BET`, `CASINO_BET`, and `ADMIN_REMOVE` may debit points.
- A user cannot self-grant and cannot bet at zero balance (`INSUFFICIENT_VIRTUAL_BALANCE`).
- Admin grants are authenticated, audited, immutable, and idempotent.
- Winning settlement credits its calculated payout exactly once; duplicate settlement never pays twice.
- Concurrent spending cannot make a balance negative.
- The remaining authentication, provider, UI, and operational requirements in the master engineering instruction are met.

