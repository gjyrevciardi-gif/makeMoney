#!/usr/bin/env node
/**
 * Read-only invariant checker for the application database.
 *
 * This tool never repairs anything. It is meant to be safe to run against
 * production at any time, and to be the first thing run after a restore — so
 * every statement executes inside a transaction that PostgreSQL itself marks
 * READ ONLY. A write introduced here by accident aborts with an error from the
 * server rather than mutating the ledger.
 *
 * Exit code 0 means every invariant held; 1 means at least one did not, or the
 * checker could not complete.
 */
const { PrismaClient } = require('@prisma/client');

const SAMPLE_LIMIT = 5;
// Prisma's interactive transactions time out after 5 seconds by default, which
// is far too short for two dozen sequential scans over a production-sized
// database. This is a read-only report, so a generous ceiling costs nothing.
const TRANSACTION_TIMEOUT_MS = Number(process.env.INTEGRITY_TIMEOUT_MS ?? 120_000);

/**
 * Each check returns the rows that violate the invariant. An empty result is a
 * pass, so every query below describes the *broken* state, never the healthy
 * one. `sample` is the column shown to the operator to start an investigation.
 */
const checks = [
  {
    name: 'no negative wallet balances',
    sample: 'id',
    query: `SELECT id FROM "Wallet" WHERE balance < 0`,
  },
  {
    name: 'wallet balance equals ledger sum',
    sample: 'id',
    query: `
      SELECT w.id
      FROM "Wallet" w
      WHERE w.balance <> COALESCE(
        (SELECT SUM(l.amount) FROM "LedgerEntry" l WHERE l."walletId" = w.id), 0)
    `,
  },
  {
    name: 'no duplicate SPORTS_WIN payouts per bet',
    sample: 'relatedBetId',
    // The NULL filter matters: grouping without it collects every win that has
    // no bet reference into one bucket and reports a false duplicate.
    query: `
      SELECT "relatedBetId"
      FROM "LedgerEntry"
      WHERE type = 'SPORTS_WIN' AND "relatedBetId" IS NOT NULL
      GROUP BY "relatedBetId"
      HAVING COUNT(*) > 1
    `,
  },
  {
    name: 'no SPORTS_WIN without a bet reference',
    sample: 'id',
    query: `SELECT id FROM "LedgerEntry" WHERE type = 'SPORTS_WIN' AND "relatedBetId" IS NULL`,
  },
  {
    name: 'no duplicate CASINO_WIN payouts per round',
    sample: 'relatedCasinoRoundId',
    query: `
      SELECT "relatedCasinoRoundId"
      FROM "LedgerEntry"
      WHERE type = 'CASINO_WIN' AND "relatedCasinoRoundId" IS NOT NULL
      GROUP BY "relatedCasinoRoundId"
      HAVING COUNT(*) > 1
    `,
  },
  {
    name: 'no CASINO_WIN without a round reference',
    sample: 'id',
    query: `SELECT id FROM "LedgerEntry" WHERE type = 'CASINO_WIN' AND "relatedCasinoRoundId" IS NULL`,
  },

  // --- Orphaned sportsbook relations -------------------------------------
  {
    name: 'no orphan bet legs',
    sample: 'id',
    query: `
      SELECT l.id FROM "BetLeg" l
      WHERE NOT EXISTS (SELECT 1 FROM "Bet" b WHERE b.id = l."betId")
    `,
  },
  {
    name: 'no ledger entries referencing a missing bet',
    sample: 'id',
    query: `
      SELECT l.id FROM "LedgerEntry" l
      WHERE l."relatedBetId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "Bet" b WHERE b.id = l."relatedBetId")
    `,
  },
  {
    name: 'no bets without an owning user',
    sample: 'id',
    query: `
      SELECT b.id FROM "Bet" b
      WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = b."userId")
    `,
  },

  // --- Orphaned casino relations -----------------------------------------
  {
    name: 'no ledger entries referencing a missing casino round',
    sample: 'id',
    query: `
      SELECT l.id FROM "LedgerEntry" l
      WHERE l."relatedCasinoRoundId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "CasinoRound" r WHERE r.id = l."relatedCasinoRoundId")
    `,
  },
  {
    name: 'no orphan casino round actions',
    sample: 'id',
    query: `
      SELECT a.id FROM "CasinoRoundAction" a
      WHERE NOT EXISTS (SELECT 1 FROM "CasinoRound" r WHERE r.id = a."roundId")
    `,
  },
  {
    name: 'no orphan casino transactions',
    sample: 'id',
    query: `
      SELECT t.id FROM "CasinoTransaction" t
      WHERE NOT EXISTS (SELECT 1 FROM "CasinoRound" r WHERE r.id = t."roundId")
    `,
  },

  // --- Settlement state consistency ---------------------------------------
  {
    name: 'settled bets record a settlement time',
    sample: 'id',
    query: `
      SELECT id FROM "Bet"
      WHERE status <> 'OPEN' AND "settledAt" IS NULL
    `,
  },
  {
    name: 'open bets carry no settlement time or payout',
    sample: 'id',
    query: `
      SELECT id FROM "Bet"
      WHERE status = 'OPEN' AND ("settledAt" IS NOT NULL OR "actualPayout" IS NOT NULL)
    `,
  },
  {
    name: 'settled bets have no legs left open',
    sample: 'id',
    // A bet cannot be resolved while one of its selections still is: that is
    // the shape a half-applied settlement would leave behind.
    query: `
      SELECT b.id FROM "Bet" b
      WHERE b.status <> 'OPEN'
        AND EXISTS (SELECT 1 FROM "BetLeg" l WHERE l."betId" = b.id AND l.status = 'OPEN')
    `,
  },
  {
    name: 'won bets have every leg won or void',
    sample: 'id',
    query: `
      SELECT b.id FROM "Bet" b
      WHERE b.status = 'WON'
        AND EXISTS (
          SELECT 1 FROM "BetLeg" l
          WHERE l."betId" = b.id AND l.status NOT IN ('WON', 'VOID')
        )
    `,
  },
  {
    name: 'won bets record a payout',
    sample: 'id',
    query: `SELECT id FROM "Bet" WHERE status = 'WON' AND "actualPayout" IS NULL`,
  },
  {
    name: 'settled casino rounds record a settlement time',
    sample: 'id',
    query: `
      SELECT id FROM "CasinoRound"
      WHERE status <> 'OPEN' AND "settledAt" IS NULL
    `,
  },
  {
    name: 'open casino rounds have paid out nothing',
    sample: 'id',
    query: `SELECT id FROM "CasinoRound" WHERE status = 'OPEN' AND payout <> 0`,
  },
  {
    name: 'losing casino rounds have paid out nothing',
    sample: 'id',
    query: `SELECT id FROM "CasinoRound" WHERE status = 'LOST' AND payout <> 0`,
  },

  // --- Casino configuration activation ------------------------------------
  {
    name: 'at most one ACTIVE version per casino game config',
    sample: 'gameConfigId',
    query: `
      SELECT "gameConfigId" FROM "CasinoGameConfigVersion"
      WHERE status = 'ACTIVE'
      GROUP BY "gameConfigId"
      HAVING COUNT(*) > 1
    `,
  },
  {
    name: 'every casino game config with versions has an ACTIVE one',
    sample: 'id',
    query: `
      SELECT c.id FROM "CasinoGameConfig" c
      WHERE EXISTS (SELECT 1 FROM "CasinoGameConfigVersion" v WHERE v."gameConfigId" = c.id)
        AND NOT EXISTS (
          SELECT 1 FROM "CasinoGameConfigVersion" v
          WHERE v."gameConfigId" = c.id AND v.status = 'ACTIVE'
        )
    `,
  },
  {
    name: 'the pointed-at active version is the ACTIVE one',
    sample: 'id',
    // activeVersionId and the version's own status are two records of the same
    // fact; a settled round is only reproducible while they agree.
    query: `
      SELECT c.id FROM "CasinoGameConfig" c
      JOIN "CasinoGameConfigVersion" v ON v.id = c."activeVersionId"
      WHERE c."activeVersionId" IS NOT NULL
        AND (v.status <> 'ACTIVE' OR v."gameConfigId" <> c.id)
    `,
  },
  {
    name: 'ACTIVE config versions record an activation time',
    sample: 'id',
    query: `SELECT id FROM "CasinoGameConfigVersion" WHERE status = 'ACTIVE' AND "activatedAt" IS NULL`,
  },
];

async function main() {
  const prisma = new PrismaClient();
  let failures = 0;

  try {
    await prisma.$transaction(async tx => {
      // Enforced by PostgreSQL, not by convention: any write attempted from
      // here on aborts the transaction instead of changing data.
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');

      for (const check of checks) {
        const rows = await tx.$queryRawUnsafe(check.query);
        if (rows.length === 0) {
          console.log(`PASS  ${check.name}`);
          continue;
        }

        failures += 1;
        const samples = rows
          .slice(0, SAMPLE_LIMIT)
          .map(row => row[check.sample])
          .join(', ');
        const more = rows.length > SAMPLE_LIMIT ? `, +${rows.length - SAMPLE_LIMIT} more` : '';
        console.log(`FAIL  ${check.name}: ${rows.length} row(s) [${samples}${more}]`);
      }
    }, { maxWait: 10_000, timeout: TRANSACTION_TIMEOUT_MS });
  } finally {
    await prisma.$disconnect();
  }

  console.log(
    failures === 0
      ? `\nAll ${checks.length} integrity checks passed.`
      : `\n${failures} of ${checks.length} integrity checks FAILED. This tool changes nothing; investigate before serving traffic.`,
  );
  return failures === 0 ? 0 : 1;
}

main()
  .then(code => {
    process.exitCode = code;
  })
  .catch(error => {
    // The message can carry a connection string, so report the type only.
    console.error(
      'Integrity checker could not complete:',
      error instanceof Error ? error.name : 'UnknownError',
    );
    process.exitCode = 1;
  });
