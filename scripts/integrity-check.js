#!/usr/bin/env node
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const checks = [
  ['negative wallets', `SELECT COUNT(*)::int AS count FROM "Wallet" WHERE balance < 0`],
  ['wallet ledger mismatches', `
    SELECT COUNT(*)::int AS count FROM "Wallet" w
    WHERE w.balance <> COALESCE((SELECT SUM(amount) FROM "LedgerEntry" l WHERE l."walletId" = w.id), 0)
  `],
  ['orphan bet relations', `
    SELECT COUNT(*)::int AS count FROM "BetLeg" l
    LEFT JOIN "Bet" b ON b.id = l."betId" WHERE b.id IS NULL
  `],
  ['orphan casino relations', `
    SELECT COUNT(*)::int AS count FROM "LedgerEntry" l
    WHERE l."relatedCasinoRoundId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "CasinoRound" r WHERE r.id = l."relatedCasinoRoundId")
  `],
  ['duplicate sports wins', `
    SELECT COUNT(*)::int AS count FROM (
      SELECT "relatedBetId" FROM "LedgerEntry"
      WHERE type = 'SPORTS_WIN' GROUP BY "relatedBetId" HAVING COUNT(*) > 1
    ) duplicates
  `],
  ['duplicate casino wins', `
    SELECT COUNT(*)::int AS count FROM (
      SELECT "relatedCasinoRoundId" FROM "LedgerEntry"
      WHERE type = 'CASINO_WIN' GROUP BY "relatedCasinoRoundId" HAVING COUNT(*) > 1
    ) duplicates
  `],
  ['active config duplicates', `
    SELECT COUNT(*)::int AS count FROM (
      SELECT "gameConfigId" FROM "CasinoGameConfigVersion"
      WHERE status = 'ACTIVE' GROUP BY "gameConfigId" HAVING COUNT(*) > 1
    ) duplicates
  `],
];

async function main() {
  let failed = false;
  for (const [name, query] of checks) {
    const rows = await prisma.$queryRawUnsafe(query);
    const count = Number(rows[0].count);
    console.log(`${count === 0 ? 'PASS' : 'FAIL'} ${name}: ${count}`);
    failed ||= count !== 0;
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Integrity checker failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
