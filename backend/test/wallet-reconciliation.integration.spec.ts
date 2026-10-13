import { randomUUID } from 'node:crypto';
import { Role } from '@prisma/client';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';
import {
  RECONCILIATION_EXIT_CODES,
  WALLET_RECONCILIATION_CHECKS,
  runWalletReconciliation,
  withReadOnlyAuditTransaction,
  resolveAuditConfig,
  type TransactionHost,
  type WalletReconciliationReport,
} from '../src/operations/wallet-reconciliation';
import {
  ReconciliationCliUsageError,
  parseReconciliationArguments,
  serializeReconciliationReport,
} from '../src/operations/wallet-reconciliation.cli-args';
import { uniqueTestEmail } from './test-identity';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const checkOf = (report: WalletReconciliationReport, code: string) =>
  report.checks.find((check) => check.code === code);

/**
 * The A5 acceptance contract for how each failure must be read: findings proven
 * by stored records alone, versus findings that also depend on the current
 * model's coverage. Asserted in full so a later edit cannot relabel a check by
 * accident.
 */
const FINDING_BASIS_BY_CODE: Record<string, string> = {
  'wallet.balance-mismatch': 'CURRENT_MODEL_INVARIANT',
  'wallet.balance-negative': 'STORED_RECORD_CONTRADICTION',
  'ledger.amount-sign': 'STORED_RECORD_CONTRADICTION',
  'ledger.balance-provenance': 'STORED_RECORD_CONTRADICTION',
  'ledger.balance-provenance-incomplete': 'CURRENT_MODEL_INVARIANT',
  'ledger.attribution': 'CURRENT_MODEL_INVARIANT',
  'ledger.transfer-pairing': 'CURRENT_MODEL_INVARIANT',
  'casino.ledger-without-transaction': 'CURRENT_MODEL_INVARIANT',
  'casino.transaction-without-ledger': 'CURRENT_MODEL_INVARIANT',
  'casino.round-missing-stake': 'CURRENT_MODEL_INVARIANT',
  'casino.round-missing-win': 'CURRENT_MODEL_INVARIANT',
  'casino.round-ownership': 'STORED_RECORD_CONTRADICTION',
  'casino.transaction-ownership': 'STORED_RECORD_CONTRADICTION',
  'ledger.sports-bet-reference-missing': 'CURRENT_MODEL_INVARIANT',
  'sports.stake-linkage': 'STORED_RECORD_CONTRADICTION',
  'sports.stake-count': 'CURRENT_MODEL_INVARIANT',
  'sports.settlement-linkage': 'STORED_RECORD_CONTRADICTION',
  'sports.settlement-linkage-legacy': 'CURRENT_MODEL_INVARIANT',
  'sports.settlement-count': 'CURRENT_MODEL_INVARIANT',
  'sports.settlement-presence': 'CURRENT_MODEL_INVARIANT',
};

describe('read-only wallet/ledger reconciliation (PostgreSQL integration)', () => {
  const prisma = new PrismaService();
  const points = new PointsService(prisma);
  let adminId: string;
  let managerId: string;
  let playerId: string;
  let walletId: string;

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // TRUNCATE is test-database teardown: the ledger's append-only trigger
    // rejects UPDATE/DELETE, so fixtures are always rebuilt from empty tables.
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "LedgerEntry", "CasinoTransaction", "CasinoRoundAction", "CasinoRound", ' +
        '"BetLeg", "Bet", "AuditLog", "SecurityEvent", "RefreshToken", "Wallet", "User" CASCADE',
    );
    adminId = (await createUser(Role.ADMIN, 'recon-admin')).id;
    managerId = (await createUser(Role.MANAGER, 'recon-manager', adminId)).id;
    const player = await createUser(Role.USER, 'recon-player', managerId);
    playerId = player.id;
    walletId = player.walletId;
  });

  async function createUser(role: Role, label: string, createdById?: string) {
    const user = await prisma.user.create({
      data: {
        email: uniqueTestEmail(label),
        passwordHash: 'test-only',
        role,
        createdById,
        wallet: { create: {} },
      },
      include: { wallet: true },
    });
    return { id: user.id, walletId: user.wallet!.id };
  }

  async function seedCasinoRound(userId: string, stake = 50n, payout = 120n) {
    return prisma.casinoRound.create({
      data: {
        userId,
        gameType: 'SLOTS',
        gameVersion: 'reconciliation-fixture.v1',
        status: 'CASHED_OUT',
        stake,
        payout,
        serverSeed: 'fixture-seed',
        serverSeedHash: 'fixture-seed-hash',
        clientSeed: 'fixture-client-seed',
        publicState: {},
        privateState: {},
        idempotencyKey: `casino:fixture:round:${randomUUID()}`,
        settledAt: new Date(),
      },
    });
  }

  /** First-party casino convention: one ledger row and one mirror per movement. */
  async function seedCasinoMovements(userId: string, walletIdForUser: string, roundId: string, stake: bigint, payout: bigint, balanceBefore: bigint) {
    const betKey = `casino:fixture:bet:${roundId}`;
    await prisma.ledgerEntry.create({
      data: {
        walletId: walletIdForUser,
        type: 'CASINO_BET',
        amount: -stake,
        reason: 'fixture wager',
        relatedCasinoRoundId: roundId,
        idempotencyKey: betKey,
        balanceBefore,
        balanceAfter: balanceBefore - stake,
      },
    });
    await prisma.casinoTransaction.create({
      data: { roundId, userId, type: 'BET', amount: -stake, idempotencyKey: betKey },
    });
    if (payout > 0n) {
      const winKey = `casino:fixture:win:${roundId}`;
      await prisma.ledgerEntry.create({
        data: {
          walletId: walletIdForUser,
          type: 'CASINO_WIN',
          amount: payout,
          reason: 'fixture payout',
          relatedCasinoRoundId: roundId,
          idempotencyKey: winKey,
          balanceBefore: balanceBefore - stake,
          balanceAfter: balanceBefore - stake + payout,
        },
      });
      await prisma.casinoTransaction.create({
        data: { roundId, userId, type: 'WIN', amount: payout, idempotencyKey: winKey },
      });
    }
  }

  async function fingerprint() {
    const wallets = await prisma.wallet.aggregate({ _sum: { balance: true }, _count: true });
    const entries = await prisma.ledgerEntry.aggregate({ _sum: { amount: true }, _count: true });
    return {
      wallets: wallets._count,
      balanceTotal: wallets._sum.balance ?? 0n,
      ledgerEntries: entries._count,
      ledgerTotal: entries._sum.amount ?? 0n,
      casinoTransactions: await prisma.casinoTransaction.count(),
      bets: await prisma.bet.count(),
    };
  }

  it('reports HEALTHY on an empty database and runs every defined check', async () => {
    const report = await runWalletReconciliation(prisma);

    expect(report.status).toBe('HEALTHY');
    expect(report.readOnly).toBe(true);
    expect(report.isolationLevel).toBe('REPEATABLE READ');
    expect(report.error).toBeNull();
    expect(report.reportVersion).toBe(2);
    expect(report.summary.checksRun).toBe(WALLET_RECONCILIATION_CHECKS.length);
    expect(report.summary.checksFailed).toBe(0);
    expect(report.summary.violations).toBe(0);
    expect(report.checks.map((check) => check.code)).toEqual(
      WALLET_RECONCILIATION_CHECKS.map((check) => check.code),
    );
    expect(report.coverage.balanceProvenance).toEqual({
      total: 0,
      verified: 0,
      unavailable: 0,
      partial: 0,
    });
    // The reading key travels with every check, pass or fail, and the contract
    // covers exactly the defined checks.
    expect(Object.fromEntries(report.checks.map((check) => [check.code, check.findingBasis]))).toEqual(
      FINDING_BASIS_BY_CODE,
    );
    expect(Object.keys(FINDING_BASIS_BY_CODE).sort()).toEqual(
      WALLET_RECONCILIATION_CHECKS.map((check) => check.code).sort(),
    );
    expect(report.checks.every((check) => check.status === 'PASS')).toBe(true);
    expect(RECONCILIATION_EXIT_CODES[report.status]).toBe(0);
  });

  it('reports HEALTHY on data written entirely through the real money paths', async () => {
    await points.adminGrant(adminId, managerId, 500n, 'manager float', 'recon-grant-manager');
    await points.adminGrant(adminId, playerId, 1000n, 'player float', 'recon-grant-player');
    await points.managerTransfer(managerId, playerId, 200n, 'stake top-up', 'recon-transfer', 'give');
    const bet = await points.placeSportsBet(playerId, 100n, 250n, 'recon-bet');
    await points.settleSportsWin(bet.id, 'recon-settle');

    const round = await seedCasinoRound(playerId);
    // 1000 grant + 200 transfer in - 100 stake + 250 win = 1350 before the round.
    await seedCasinoMovements(playerId, walletId, round.id, 50n, 120n, 1350n);

    // A blackjack-style double down: a SECOND stake debit, and a round stake
    // that now equals the total. Neither may be read as a stake mismatch.
    const doubled = await seedCasinoRound(playerId, 100n, 180n);
    const primaryKey = `casino:fixture:bet:${doubled.id}`;
    const doubleKey = `${primaryKey}:double`;
    const winKey = `casino:fixture:win:${doubled.id}`;
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'CASINO_BET',
        amount: -50n,
        reason: 'fixture wager',
        relatedCasinoRoundId: doubled.id,
        idempotencyKey: primaryKey,
        balanceBefore: 1420n,
        balanceAfter: 1370n,
      },
    });
    await prisma.casinoTransaction.create({
      data: { roundId: doubled.id, userId: playerId, type: 'BET', amount: -50n, idempotencyKey: primaryKey },
    });
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'CASINO_BET',
        amount: -50n,
        reason: 'fixture double down',
        relatedCasinoRoundId: doubled.id,
        idempotencyKey: doubleKey,
        balanceBefore: 1370n,
        balanceAfter: 1320n,
      },
    });
    await prisma.casinoTransaction.create({
      data: { roundId: doubled.id, userId: playerId, type: 'BET', amount: -50n, idempotencyKey: doubleKey },
    });
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'CASINO_WIN',
        amount: 180n,
        reason: 'fixture payout',
        relatedCasinoRoundId: doubled.id,
        idempotencyKey: winKey,
        balanceBefore: 1320n,
        balanceAfter: 1500n,
      },
    });
    await prisma.casinoTransaction.create({
      data: { roundId: doubled.id, userId: playerId, type: 'WIN', amount: 180n, idempotencyKey: winKey },
    });
    // Two winning credits for one round are legitimate, so the payout check
    // must sum them rather than assume a single credit.
    const multiCredit = await seedCasinoRound(playerId, 50n, 100n);
    const multiStakeKey = `casino:fixture:bet:${multiCredit.id}`;
    const firstWinKey = `casino:fixture:win:${multiCredit.id}:a`;
    const secondWinKey = `casino:fixture:win:${multiCredit.id}:b`;
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'CASINO_BET',
        amount: -50n,
        reason: 'fixture wager',
        relatedCasinoRoundId: multiCredit.id,
        idempotencyKey: multiStakeKey,
        balanceBefore: 1500n,
        balanceAfter: 1450n,
      },
    });
    await prisma.casinoTransaction.create({
      data: { roundId: multiCredit.id, userId: playerId, type: 'BET', amount: -50n, idempotencyKey: multiStakeKey },
    });
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'CASINO_WIN',
        amount: 60n,
        reason: 'fixture payout a',
        relatedCasinoRoundId: multiCredit.id,
        idempotencyKey: firstWinKey,
        balanceBefore: 1450n,
        balanceAfter: 1510n,
      },
    });
    await prisma.casinoTransaction.create({
      data: { roundId: multiCredit.id, userId: playerId, type: 'WIN', amount: 60n, idempotencyKey: firstWinKey },
    });
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'CASINO_WIN',
        amount: 40n,
        reason: 'fixture payout b',
        relatedCasinoRoundId: multiCredit.id,
        idempotencyKey: secondWinKey,
        balanceBefore: 1510n,
        balanceAfter: 1550n,
      },
    });
    await prisma.casinoTransaction.create({
      data: { roundId: multiCredit.id, userId: playerId, type: 'WIN', amount: 40n, idempotencyKey: secondWinKey },
    });
    await prisma.wallet.update({ where: { id: walletId }, data: { balance: 1550n } });

    const report = await runWalletReconciliation(prisma);

    expect(report.status).toBe('HEALTHY');
    expect(report.summary.violations).toBe(0);
    expect(checkOf(report, 'casino.round-missing-stake')?.status).toBe('PASS');
    expect(checkOf(report, 'casino.round-missing-win')?.status).toBe('PASS');
    // The legacy settle path records WON with no payout column, and its single
    // proven credit is the bet's potential payout: that must stay healthy.
    expect(checkOf(report, 'sports.settlement-linkage')?.status).toBe('PASS');
    expect(checkOf(report, 'sports.settlement-linkage-legacy')?.status).toBe('PASS');
    // The first-party rows carry no transition evidence at all, which is
    // reported as coverage instead of an anomaly.
    expect(report.coverage.balanceProvenance.partial).toBe(0);
    expect(report.coverage.balanceProvenance.verified).toBeGreaterThanOrEqual(8);
    expect(report.coverage.balanceProvenance.unavailable).toBeGreaterThanOrEqual(1);
    expect(
      report.coverage.balanceProvenance.verified + report.coverage.balanceProvenance.unavailable,
    ).toBe(report.coverage.balanceProvenance.total);
  });

  it('reports INCOMPLETE, never a pass, for an invalid configuration', async () => {
    const report = await runWalletReconciliation(prisma, { config: { transactionTimeoutMs: '0' } });

    expect(report.status).toBe('INCOMPLETE');
    expect(report.error).toEqual({ code: 'INVALID_TRANSACTION_TIMEOUT' });
    expect(report.checks).toEqual([]);
    // A run that did not complete attests nothing, so it reports no coverage.
    expect(report.coverage.balanceProvenance).toEqual({
      total: 0,
      verified: 0,
      unavailable: 0,
      partial: 0,
    });
    expect(RECONCILIATION_EXIT_CODES[report.status]).toBe(2);
  });

  it('reports absent before/after evidence as UNVERIFIABLE coverage, not as an anomaly', async () => {
    // Every first-party writer records no transition columns. That is the
    // legacy-shaped, unverifiable case: limited assurance, not an anomaly.
    await points.adminGrant(adminId, playerId, 100n, 'legacy float', 'coverage-legacy-grant');

    const report = await runWalletReconciliation(prisma);

    expect(report.status).toBe('HEALTHY');
    expect(report.summary.checksFailed).toBe(0);
    expect(report.coverage.balanceProvenance).toEqual({
      total: 1,
      verified: 0,
      unavailable: 1,
      partial: 0,
    });
    expect(checkOf(report, 'ledger.balance-provenance')?.status).toBe('PASS');
    expect(checkOf(report, 'ledger.balance-provenance-incomplete')?.status).toBe('PASS');
  });

  it('separates a stored arithmetic contradiction from a partial provenance pair', async () => {
    await points.adminGrant(adminId, playerId, 100n, 'base float', 'coverage-base-grant');
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'ADMIN_GRANT',
        amount: 5n,
        reason: 'bad arithmetic',
        actorId: adminId,
        idempotencyKey: 'coverage-contradiction',
        balanceBefore: 100n,
        balanceAfter: 999n,
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'ADMIN_GRANT',
        amount: 3n,
        reason: 'half a transition pair',
        actorId: adminId,
        idempotencyKey: 'coverage-partial',
        balanceBefore: 105n,
      },
    });
    await prisma.wallet.update({ where: { id: walletId }, data: { balance: 108n } });

    const report = await runWalletReconciliation(prisma);

    expect(report.status).toBe('ANOMALY');
    expect(checkOf(report, 'wallet.balance-mismatch')?.status).toBe('PASS');
    expect(checkOf(report, 'ledger.balance-provenance')?.status).toBe('FAIL');
    expect(checkOf(report, 'ledger.balance-provenance')?.findingBasis).toBe(
      'STORED_RECORD_CONTRADICTION',
    );
    expect(checkOf(report, 'ledger.balance-provenance')?.violationCount).toBe(1);
    expect(checkOf(report, 'ledger.balance-provenance-incomplete')?.status).toBe('FAIL');
    expect(checkOf(report, 'ledger.balance-provenance-incomplete')?.findingBasis).toBe(
      'CURRENT_MODEL_INVARIANT',
    );
    expect(checkOf(report, 'ledger.balance-provenance-incomplete')?.violationCount).toBe(1);
    expect(report.coverage.balanceProvenance).toEqual({
      total: 3,
      verified: 1,
      unavailable: 1,
      partial: 1,
    });
  });

  it('detects a wallet whose balance does not equal the exact BigInt ledger sum', async () => {
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'ADMIN_GRANT',
        amount: 100n,
        reason: 'unapplied grant',
        actorId: adminId,
        idempotencyKey: 'recon-unapplied-grant',
      },
    });

    const report = await runWalletReconciliation(prisma);

    expect(report.status).toBe('ANOMALY');
    expect(checkOf(report, 'wallet.balance-mismatch')?.status).toBe('FAIL');
    expect(checkOf(report, 'wallet.balance-mismatch')?.violationCount).toBe(1);
    expect(checkOf(report, 'ledger.amount-sign')?.status).toBe('PASS');
  });

  it('detects a casino ledger movement with no matching CasinoTransaction', async () => {
    const round = await seedCasinoRound(playerId);
    const entry = await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'CASINO_BET',
        amount: -50n,
        reason: 'fixture wager',
        relatedCasinoRoundId: round.id,
        idempotencyKey: `casino:fixture:bet:${round.id}`,
      },
    });

    const report = await runWalletReconciliation(prisma, { config: { includeReferences: true } });

    expect(report.status).toBe('ANOMALY');
    expect(checkOf(report, 'casino.ledger-without-transaction')?.status).toBe('FAIL');
    expect(checkOf(report, 'casino.ledger-without-transaction')?.sampleReferences).toEqual([entry.id]);
  });

  it('detects a CasinoTransaction with no matching ledger movement', async () => {
    const round = await seedCasinoRound(playerId);
    const transaction = await prisma.casinoTransaction.create({
      data: {
        roundId: round.id,
        userId: playerId,
        type: 'WIN',
        amount: 120n,
        idempotencyKey: `casino:fixture:win:${round.id}`,
      },
    });

    const report = await runWalletReconciliation(prisma, { config: { includeReferences: true } });

    expect(report.status).toBe('ANOMALY');
    expect(checkOf(report, 'casino.transaction-without-ledger')?.status).toBe('FAIL');
    expect(checkOf(report, 'casino.transaction-without-ledger')?.sampleReferences).toEqual([
      transaction.id,
    ]);
  });

  it('detects a casino movement whose ledger and domain amounts disagree', async () => {
    const round = await seedCasinoRound(playerId);
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'CASINO_BET',
        amount: -50n,
        reason: 'fixture wager',
        relatedCasinoRoundId: round.id,
        idempotencyKey: `casino:fixture:bet:${round.id}`,
      },
    });
    await prisma.casinoTransaction.create({
      data: {
        roundId: round.id,
        userId: playerId,
        type: 'BET',
        amount: -60n,
        idempotencyKey: `casino:fixture:bet:${round.id}`,
      },
    });

    const report = await runWalletReconciliation(prisma);

    expect(report.status).toBe('ANOMALY');
    expect(checkOf(report, 'casino.ledger-without-transaction')?.status).toBe('FAIL');
    expect(checkOf(report, 'casino.transaction-without-ledger')?.status).toBe('FAIL');
  });

  it('detects a round with a stake whose paid stake debit and domain mirror are both missing', async () => {
    // No ledger row and no CasinoTransaction at all: the wallet/ledger totals
    // stay consistent, so only a round-driven check can see this.
    const round = await seedCasinoRound(playerId);

    const report = await runWalletReconciliation(prisma, { config: { includeReferences: true } });

    expect(report.status).toBe('ANOMALY');
    expect(checkOf(report, 'casino.round-missing-stake')?.status).toBe('FAIL');
    expect(checkOf(report, 'casino.round-missing-stake')?.violationCount).toBe(1);
    expect(checkOf(report, 'casino.round-missing-stake')?.sampleReferences).toEqual([round.id]);
    expect(checkOf(report, 'wallet.balance-mismatch')?.status).toBe('PASS');
    expect(checkOf(report, 'casino.ledger-without-transaction')?.status).toBe('PASS');
    expect(checkOf(report, 'casino.transaction-without-ledger')?.status).toBe('PASS');
  });

  it('detects a round that records a payout with no winning credit at all', async () => {
    const round = await seedCasinoRound(playerId);
    await points.adminGrant(adminId, playerId, 100n, 'probe float', 'round-win-float');
    const stakeKey = `casino:fixture:bet:${round.id}`;
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'CASINO_BET',
        amount: -50n,
        reason: 'fixture wager',
        relatedCasinoRoundId: round.id,
        idempotencyKey: stakeKey,
        balanceBefore: 100n,
        balanceAfter: 50n,
      },
    });
    await prisma.casinoTransaction.create({
      data: { roundId: round.id, userId: playerId, type: 'BET', amount: -50n, idempotencyKey: stakeKey },
    });
    // The stake is paid and mirrored; the payout has no ledger movement, and
    // the wallet still equals its ledger, so only a round-driven check sees it.
    await prisma.wallet.update({ where: { id: walletId }, data: { balance: 50n } });

    const report = await runWalletReconciliation(prisma, { config: { includeReferences: true } });

    expect(report.status).toBe('ANOMALY');
    expect(checkOf(report, 'casino.round-missing-win')?.status).toBe('FAIL');
    expect(checkOf(report, 'casino.round-missing-win')?.violationCount).toBe(1);
    expect(checkOf(report, 'casino.round-missing-win')?.sampleReferences).toEqual([round.id]);
    expect(checkOf(report, 'wallet.balance-mismatch')?.status).toBe('PASS');
    expect(checkOf(report, 'casino.round-missing-stake')?.status).toBe('PASS');
    expect(checkOf(report, 'casino.ledger-without-transaction')?.status).toBe('PASS');
    expect(checkOf(report, 'casino.transaction-without-ledger')?.status).toBe('PASS');
    expect(report.summary.checksFailed).toBe(1);
  });

  it('detects a winning credit recorded on a round that records no payout', async () => {
    const round = await seedCasinoRound(playerId, 50n, 0n);
    await points.adminGrant(adminId, playerId, 100n, 'probe float', 'round-nopayout-float');
    const stakeKey = `casino:fixture:bet:${round.id}`;
    const winKey = `casino:fixture:win:${round.id}`;
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'CASINO_BET',
        amount: -50n,
        reason: 'fixture wager',
        relatedCasinoRoundId: round.id,
        idempotencyKey: stakeKey,
        balanceBefore: 100n,
        balanceAfter: 50n,
      },
    });
    await prisma.casinoTransaction.create({
      data: { roundId: round.id, userId: playerId, type: 'BET', amount: -50n, idempotencyKey: stakeKey },
    });
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'CASINO_WIN',
        amount: 60n,
        reason: 'fixture payout',
        relatedCasinoRoundId: round.id,
        idempotencyKey: winKey,
        balanceBefore: 50n,
        balanceAfter: 110n,
      },
    });
    await prisma.casinoTransaction.create({
      data: { roundId: round.id, userId: playerId, type: 'WIN', amount: 60n, idempotencyKey: winKey },
    });
    await prisma.wallet.update({ where: { id: walletId }, data: { balance: 110n } });

    const report = await runWalletReconciliation(prisma);

    expect(report.status).toBe('ANOMALY');
    expect(checkOf(report, 'casino.round-missing-win')?.status).toBe('FAIL');
    expect(checkOf(report, 'casino.round-missing-win')?.violationCount).toBe(1);
    expect(checkOf(report, 'wallet.balance-mismatch')?.status).toBe('PASS');
    expect(checkOf(report, 'casino.ledger-without-transaction')?.status).toBe('PASS');
    expect(checkOf(report, 'casino.transaction-without-ledger')?.status).toBe('PASS');
    expect(report.summary.checksFailed).toBe(1);
  });

  it('detects a casino ledger movement recorded against another user round', async () => {
    const other = await createUser(Role.USER, 'recon-other');
    const round = await seedCasinoRound(other.id);
    const key = `casino:fixture:bet:${round.id}`;
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'CASINO_BET',
        amount: -50n,
        reason: 'fixture wager',
        relatedCasinoRoundId: round.id,
        idempotencyKey: key,
      },
    });
    await prisma.casinoTransaction.create({
      data: { roundId: round.id, userId: other.id, type: 'BET', amount: -50n, idempotencyKey: key },
    });

    const report = await runWalletReconciliation(prisma);

    expect(report.status).toBe('ANOMALY');
    expect(checkOf(report, 'casino.round-ownership')?.status).toBe('FAIL');
    expect(checkOf(report, 'casino.transaction-ownership')?.status).toBe('PASS');
  });

  it('detects a CasinoTransaction recorded for a different user than its round', async () => {
    const other = await createUser(Role.USER, 'recon-owner');
    const round = await seedCasinoRound(other.id);
    await prisma.casinoTransaction.create({
      data: {
        roundId: round.id,
        userId: playerId,
        type: 'WIN',
        amount: 120n,
        idempotencyKey: `casino:fixture:win:${round.id}`,
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'CASINO_WIN',
        amount: 120n,
        reason: 'fixture payout',
        relatedCasinoRoundId: round.id,
        idempotencyKey: `casino:fixture:win:${round.id}`,
      },
    });

    const report = await runWalletReconciliation(prisma);

    expect(report.status).toBe('ANOMALY');
    expect(checkOf(report, 'casino.transaction-ownership')?.status).toBe('FAIL');
    expect(checkOf(report, 'casino.round-ownership')?.status).toBe('FAIL');
  });

  it('detects a duplicated and a mismatched sports settlement credit', async () => {
    const bet = await prisma.bet.create({
      data: {
        userId: playerId,
        stake: 100n,
        potentialPayout: 250n,
        actualPayout: 250n,
        status: 'WON',
        settledAt: new Date(),
        idempotencyKey: 'recon-dup-bet',
      },
    });
    for (const key of ['recon-dup-win-1', 'recon-dup-win-2']) {
      await prisma.ledgerEntry.create({
        data: {
          walletId,
          type: 'SPORTS_WIN',
          amount: 250n,
          reason: 'Sportsbook winning payout',
          relatedBetId: bet.id,
          idempotencyKey: key,
        },
      });
    }

    const report = await runWalletReconciliation(prisma, { config: { includeReferences: true } });

    expect(report.status).toBe('ANOMALY');
    expect(checkOf(report, 'sports.settlement-count')?.status).toBe('FAIL');
    expect(checkOf(report, 'sports.settlement-count')?.sampleReferences).toEqual([bet.id]);
    expect(checkOf(report, 'sports.settlement-presence')?.status).toBe('FAIL');
  });

  it('detects a sports stake that does not match its bet, and a missing stake debit', async () => {
    const mismatched = await prisma.bet.create({
      data: {
        userId: playerId,
        stake: 100n,
        potentialPayout: 200n,
        status: 'OPEN',
        idempotencyKey: 'recon-stake-bet',
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'SPORTS_BET',
        amount: -50n,
        reason: 'Sports bet stake',
        relatedBetId: mismatched.id,
        idempotencyKey: 'recon-stake-entry',
      },
    });
    const missing = await prisma.bet.create({
      data: {
        userId: playerId,
        stake: 70n,
        potentialPayout: 140n,
        status: 'OPEN',
        idempotencyKey: 'recon-stake-missing',
      },
    });

    const report = await runWalletReconciliation(prisma);

    expect(report.status).toBe('ANOMALY');
    expect(checkOf(report, 'sports.stake-linkage')?.status).toBe('FAIL');
    expect(checkOf(report, 'sports.stake-count')?.status).toBe('FAIL');
    expect(checkOf(report, 'sports.stake-count')?.violationCount).toBe(2);
    expect(missing.id).toBeDefined();
  });

  it('detects a settlement credit recorded for a bet that is not settled to that outcome', async () => {
    const openBet = await prisma.bet.create({
      data: {
        userId: playerId,
        stake: 100n,
        potentialPayout: 250n,
        status: 'OPEN',
        idempotencyKey: 'recon-status-open',
      },
    });
    const lostBet = await prisma.bet.create({
      data: {
        userId: playerId,
        stake: 30n,
        potentialPayout: 60n,
        status: 'LOST',
        settledAt: new Date(),
        idempotencyKey: 'recon-status-lost',
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'SPORTS_WIN',
        amount: 250n,
        reason: 'premature payout',
        relatedBetId: openBet.id,
        idempotencyKey: 'recon-status-open-win',
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'BET_VOID_REFUND',
        amount: 30n,
        reason: 'refund of a lost bet',
        relatedBetId: lostBet.id,
        idempotencyKey: 'recon-status-lost-refund',
      },
    });
    // The wallet total still matches its ledger, so only the status decides.
    await prisma.wallet.update({ where: { id: walletId }, data: { balance: 280n } });

    const report = await runWalletReconciliation(prisma);

    expect(report.status).toBe('ANOMALY');
    expect(checkOf(report, 'wallet.balance-mismatch')?.status).toBe('PASS');
    expect(checkOf(report, 'sports.settlement-linkage')?.status).toBe('FAIL');
    expect(checkOf(report, 'sports.settlement-linkage')?.violationCount).toBe(2);
  });

  it('detects a transfer entry with no equal and opposite partner', async () => {
    await prisma.wallet.update({ where: { id: walletId }, data: { balance: 0n } });
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'TRANSFER_IN',
        amount: 25n,
        reason: 'orphaned transfer',
        actorId: managerId,
        idempotencyKey: 'recon-transfer-orphan:in',
      },
    });

    const report = await runWalletReconciliation(prisma);

    expect(report.status).toBe('ANOMALY');
    expect(checkOf(report, 'ledger.transfer-pairing')?.status).toBe('FAIL');
  });

  it('detects a transfer pair whose halves name different actors', async () => {
    const other = await createUser(Role.MANAGER, 'recon-manager-two', adminId);
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'TRANSFER_OUT',
        amount: -25n,
        reason: 'split-brain transfer',
        actorId: managerId,
        idempotencyKey: 'recon-transfer-actor:out',
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        walletId: other.walletId,
        type: 'TRANSFER_IN',
        amount: 25n,
        reason: 'split-brain transfer',
        actorId: other.id,
        idempotencyKey: 'recon-transfer-actor:in',
      },
    });

    const report = await runWalletReconciliation(prisma);

    expect(report.status).toBe('ANOMALY');
    expect(checkOf(report, 'ledger.transfer-pairing')?.status).toBe('FAIL');
    expect(checkOf(report, 'ledger.transfer-pairing')?.violationCount).toBe(2);
  });

  it('emits no user or wallet identifier by default, and only opaque records when asked', async () => {
    const round = await seedCasinoRound(playerId);
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'CASINO_BET',
        amount: -50n,
        reason: 'fixture wager',
        relatedCasinoRoundId: round.id,
        idempotencyKey: `casino:fixture:bet:${round.id}`,
      },
    });

    const quiet = await runWalletReconciliation(prisma);
    const verbose = await runWalletReconciliation(prisma, { config: { includeReferences: true } });

    expect(checkOf(quiet, 'casino.ledger-without-transaction')?.sampleReferences).toEqual([]);
    expect(checkOf(quiet, 'casino.ledger-without-transaction')?.sampleTruncated).toBe(true);
    expect(checkOf(verbose, 'casino.ledger-without-transaction')?.sampleReferences).toHaveLength(1);
    for (const report of [quiet, verbose]) {
      const serialized = JSON.stringify(report);
      expect(serialized).not.toContain(playerId);
      expect(serialized).not.toContain(walletId);
      expect(serialized).not.toContain(adminId);
    }
  });

  it('changes nothing when it finds an anomaly, and reports the same anomaly on retry', async () => {
    await prisma.ledgerEntry.create({
      data: {
        walletId,
        type: 'ADMIN_GRANT',
        amount: 100n,
        reason: 'unapplied grant',
        actorId: adminId,
        idempotencyKey: 'recon-retry-grant',
      },
    });
    const before = await fingerprint();

    const first = await runWalletReconciliation(prisma);
    const second = await runWalletReconciliation(prisma);

    expect(await fingerprint()).toEqual(before);
    expect(first.status).toBe('ANOMALY');
    expect(second.status).toBe('ANOMALY');
    expect(second.checks.map((check) => `${check.code}:${check.status}`)).toEqual(
      first.checks.map((check) => `${check.code}:${check.status}`),
    );
  });

  it('enforces the read-only transaction in PostgreSQL, not by convention', async () => {
    let thrown: unknown;
    try {
      await withReadOnlyAuditTransaction(prisma, resolveAuditConfig(), async (tx) => {
        await tx.$executeRawUnsafe('UPDATE "Wallet" SET "balance" = "balance"');
        return null;
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const metaCode = (thrown as { meta?: { code?: unknown } }).meta?.code;
    expect(metaCode === '25006' || /read-only transaction/i.test(String(thrown))).toBe(true);
    expect(await prisma.wallet.count()).toBe(3);
  });

  it('holds one fixed snapshot, so a movement committed mid-audit cannot make the report inconsistent', async () => {
    const observed: bigint[] = [];
    const reachedBarrier = deferred();
    const releaseBarrier = deferred();

    const audit = runWalletReconciliation(prisma, {
      hooks: {
        afterStep: async ({ index, tx }) => {
          if (index !== 0) return;
          observed.push((await tx.wallet.findUniqueOrThrow({ where: { id: walletId } })).balance);
          reachedBarrier.resolve();
          await releaseBarrier.promise;
          observed.push((await tx.wallet.findUniqueOrThrow({ where: { id: walletId } })).balance);
        },
      },
    });

    await reachedBarrier.promise;
    await points.adminGrant(adminId, playerId, 500n, 'mid-audit movement', 'recon-mid-audit');
    // A separate connection already sees the committed movement...
    expect((await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })).balance).toBe(500n);
    releaseBarrier.resolve();

    const report = await audit;
    // ...while the audit transaction still reads the snapshot it started with.
    expect(observed).toEqual([0n, 0n]);
    expect(report.status).toBe('HEALTHY');
    expect((await runWalletReconciliation(prisma)).status).toBe('HEALTHY');
  });

  it('skips a second overlapping run immediately and runs again once the first has finished', async () => {
    const reachedBarrier = deferred();
    const releaseBarrier = deferred();

    const first = runWalletReconciliation(prisma, {
      hooks: {
        afterStep: async ({ index }) => {
          if (index !== 0) return;
          reachedBarrier.resolve();
          await releaseBarrier.promise;
        },
      },
    });
    await reachedBarrier.promise;

    const overlapping = await runWalletReconciliation(prisma);
    expect(overlapping.status).toBe('SKIPPED_ALREADY_RUNNING');
    expect(overlapping.error).toBeNull();
    expect(overlapping.summary.checksRun).toBe(0);
    expect(RECONCILIATION_EXIT_CODES[overlapping.status]).toBe(3);

    releaseBarrier.resolve();
    expect((await first).status).toBe('HEALTHY');
    expect((await runWalletReconciliation(prisma)).status).toBe('HEALTHY');
  });
});

describe('reconciliation CLI contract (no database)', () => {
  const unusedHost = {
    $transaction: () => {
      throw new Error('this case must not reach the database');
    },
  } as unknown as TransactionHost;

  it('serializes a run as exactly one compact JSON line', async () => {
    const report = await runWalletReconciliation(unusedHost, { config: { sampleLimit: '0' } });
    expect(report.status).toBe('INCOMPLETE');

    const serialized = serializeReconciliationReport(report);

    expect(serialized.endsWith('\n')).toBe(true);
    expect(serialized.trimEnd()).not.toContain('\n');
    expect(JSON.parse(serialized)).toEqual(report);
  });

  it('accepts exactly the documented flags', () => {
    expect(parseReconciliationArguments(['--help'])).toEqual({ input: {}, help: true });
    expect(
      parseReconciliationArguments([
        '--include-references',
        '--timeout-ms=5000',
        '--statement-timeout-ms=2500',
        '--sample-limit=10',
      ]),
    ).toEqual({
      input: {
        includeReferences: true,
        transactionTimeoutMs: '5000',
        statementTimeoutMs: '2500',
        sampleLimit: '10',
      },
      help: false,
    });
  });

  it('refuses unknown, malformed and positional arguments instead of ignoring them', () => {
    const rejected = [
      ['--bogus'],
      ['--include-references=true'],
      ['--timeout-ms'],
      ['--timeout-ms='],
      ['--sample-limit', '10'],
      ['stray-positional'],
    ];
    for (const argv of rejected) {
      let thrown: unknown;
      try {
        parseReconciliationArguments(argv);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ReconciliationCliUsageError);
      expect((thrown as ReconciliationCliUsageError).code).toBe('INVALID_ARGUMENT');
    }
  });
});
