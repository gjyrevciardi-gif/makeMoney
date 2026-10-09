# Launch acceptance - focused run evidence

Branch `feature/book-of-ra-current`, HEAD `d6cb445d29dc6fae0f783bcfb15e1c5e13873fbc`
before and after (no commit, merge, rebase, push, deploy, or staging). Spec
sha256 `C85090418B98E86CCE36D294575D4C9B1A7F38EB3B548AA1513BDA00923D8103`
before and after the run (unchanged during execution).

## Command

```
npm run test -w backend -- test/book-of-ra-classic.launch-acceptance.spec.ts
```

- env (process-only, credentials read from the container and never printed):
  `DATABASE_URL=postgresql://gate_runner:***@127.0.0.1:55434/book_classic_db_gate_test?schema=public`,
  `REDIS_URL=redis://127.0.0.1:56380`
- exit 0, `Test Suites: 1 passed, 1 total`, `Tests: 1 passed, 1 total`, 17.585 s.
- full output: `launch-acceptance-current-run.log`

## Isolated-database evidence (read-only, after the run)

The spec truncates every Classic/user table in `beforeEach`, so these rows are
exactly the focused run's footprint.

```
 role        | balance | ledger_rows
 USER        |   99991 |           2
 ADMIN       |       0 |           0
 SUPER_ADMIN |       0 |           0

 type        | n | total
 ADMIN_GRANT | 1 | 100000
 CASINO_BET  | 1 |     -9
```

```
 id=a6f601fe-0e50-4396-b5b6-bde9ee7b8648 status=OPEN stake=9 payout=0
 gameVersion=book-of-ra-classic.v1 userId=d4c6574f-1208-4c05-afa4-d959c099167e

 seq=133 action=bet userId=d4c6574f-1208-4c05-afa4-d959c099167e
 roundId=a6f601fe-0e50-4396-b5b6-bde9ee7b8648 gameId=book-of-ra-classic
 canonical={"event":"bet","lines":9,"player":"d4c6574f-1208-4c05-afa4-d959c099167e","stake":1}

 rounds=1 actions=1 txn=1 prepared=0 user_sessions=2 revoked_user_sessions=1
```

`revoked_user_sessions=1` is the destroyed pre-reconstruction session; the
recovery launch re-created one, both bound to the same USER. `prepared=0` shows
the one paid outcome settled cleanly with nothing left dangling.
