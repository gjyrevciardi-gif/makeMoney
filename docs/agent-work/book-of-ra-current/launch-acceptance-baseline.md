# Launch acceptance - pre-run baseline

Captured 2026-10-09T03:22:58+02:00 (Central European Standard Time), before the
focused run of this file.

## Repository attribution

- Branch: `feature/book-of-ra-current`
- HEAD: `d6cb445d29dc6fae0f783bcfb15e1c5e13873fbc`
- No commit, merge, rebase, push or deploy. Environment variables are set per
  process only; credentials are read from the container env and never printed.

## Spec under test

| item | value |
| --- | --- |
| path | `backend/test/book-of-ra-classic.launch-acceptance.spec.ts` |
| sha256 | `C85090418B98E86CCE36D294575D4C9B1A7F38EB3B548AA1513BDA00923D8103` |
| bytes | 16084 |
| lines | 329 |

This is the post-correction baseline: the single consolidated harness
correction (extraneous foreign-owner block removed, action-count/owner/stored
payload assertions added, recovery turned into a real runtime reconstruction)
was applied before the baseline hash above. Nothing else in the file changes at
run time; the runner writes only the log below.

## Tracked files already dirty at baseline (pre-existing)

```
 M artifacts/math-validation/lucky-lady/lucky-lady.rtp40.g1c8ab822fd16/bankroll-1.json
 M artifacts/math-validation/lucky-lady/lucky-lady.rtp40.g1c8ab822fd16/validation-1.json
 M artifacts/math-validation/lucky-lady/lucky-lady.rtp50.gdfef8c399389/bankroll-1.json
 M artifacts/math-validation/lucky-lady/lucky-lady.rtp50.gdfef8c399389/validation-1.json
 M artifacts/math-validation/lucky-lady/lucky-lady.rtp70.gf7ac0d49615a/bankroll-1.json
 M artifacts/math-validation/lucky-lady/lucky-lady.rtp70.gf7ac0d49615a/validation-1.json
 M artifacts/math-validation/lucky-lady/lucky-lady.rtp80.g4fa0b1386b06/bankroll-1.json
 M artifacts/math-validation/lucky-lady/lucky-lady.rtp80.g4fa0b1386b06/validation-1.json
 M backend/nest-cli.json
 M backend/src/casino/casino-config.defaults.ts
 M backend/src/casino/casino-game.registry.ts
 M backend/src/casino/casino.module.ts
 M backend/src/casino/games/lucky-lady/payout/lucky-lady-payout.service.ts
 M backend/src/casino/platform/math-control/math-control.controller.ts
 M backend/src/casino/platform/math-control/math-control.dto.ts
 M backend/src/casino/platform/math-control/math-control.service.ts
 M backend/src/casino/platform/math-control/math-control.types.ts
 M backend/src/common/safe-exception.filter.ts
 M backend/test/casino-admin-config.integration.spec.ts
 M backend/test/casino-registry-favorites.integration.spec.ts
 M docs/agent-work/game-math-profiles/reports/lucky-lady/lucky-lady.rtp40.g1c8ab822fd16-bankroll.md
 M docs/agent-work/game-math-profiles/reports/lucky-lady/lucky-lady.rtp50.gdfef8c399389-bankroll.md
 M docs/agent-work/game-math-profiles/reports/lucky-lady/lucky-lady.rtp70.gf7ac0d49615a-bankroll.md
 M docs/agent-work/game-math-profiles/reports/lucky-lady/lucky-lady.rtp80.g4fa0b1386b06-bankroll.md
 M frontend/components/casino/casino-game-card.tsx
```

`backend/src/common/safe-exception.filter.ts` carries a `M` flag but an empty
content diff (it is absent from `git diff --stat`); this is the pre-existing
CRLF line-ending artefact, not a lasting production edit.

## Untracked paths at baseline (pre-existing)

```
?? artifacts/math-validation/book-of-ra-classic/
?? backend/src/casino/games/book-of-ra-classic/
?? backend/test/book-of-ra-classic.admin-current-default.spec.ts
?? backend/test/book-of-ra-classic.admin-math-registration.spec.ts
?? backend/test/book-of-ra-classic.concurrent-bet-race.spec.ts
?? backend/test/book-of-ra-classic.default-activate-cycle.spec.ts
?? backend/test/book-of-ra-classic.default-integration.spec.ts
?? backend/test/book-of-ra-classic.integration.spec.ts
?? backend/test/book-of-ra-classic.launch-acceptance.spec.ts
?? backend/test/book-of-ra-classic.math-control.integration.spec.ts
?? backend/test/book-of-ra-classic.math.spec.ts
?? backend/test/book-of-ra-classic.shared-history-rollback.spec.ts
?? backend/test/book-of-ra-classic.wallet-replay-recovery.spec.ts
?? docs/agent-work/book-of-ra-current/
?? docs/agent-work/game-math-profiles/reports/book-of-ra-classic/
?? frontend/app/casino/slots/book-of-ra-classic/
?? games/book-of-ra-classic/
```

## Isolated test targets

- PostgreSQL: `boc-dbgate-pg` at `127.0.0.1:55434`, database
  `book_classic_db_gate_test`, user `gate_runner` (password read from the
  container env at run time, never printed).
- Redis: `127.0.0.1:56380` (`gat-p0-redis-test`).
