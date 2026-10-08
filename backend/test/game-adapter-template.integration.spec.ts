import { HttpException } from '@nestjs/common';
import { GameGatewayBase } from '../src/casino/platform/game-gateway.base';
import { LuckyLadyController } from '../src/casino/games/lucky-lady/lucky-lady.controller';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';
import { GameCapabilityService } from '../src/casino/platform/game-capability.service';
import { GameJournalService } from '../src/casino/platform/game-journal.service';
import { GameRoundService } from '../src/casino/platform/game-round.service';
import { GameWalletService } from '../src/casino/platform/game-wallet.service';
import { GameActionContext, GamePlatform } from '../src/casino/platform/game-adapter.types';
import { COIN_FLIP_GAME_ID, CoinFlipAdapter } from './fixtures/coin-flip.adapter';
import { uniqueTestEmail } from './test-identity';

const PLATFORM_DIR = join(__dirname, '..', 'src', 'casino', 'platform');
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Second-adapter readiness.
 *
 * A complete second game - its own id, its own events, its own canonical
 * semantics, its own round projection and recovery payload - written against
 * nothing but the shared integration layer. Nothing in `src/casino/platform`
 * changed to make it work, which is the architectural claim under test.
 */
describe('game integration layer - second adapter readiness (PostgreSQL)', () => {
  const prisma = new PrismaService();
  const points = new PointsService(prisma);

  // The shared layer asks the platform two questions; a fixture answers them
  // without a registry entry, which is exactly what a second game must do.
  const availability = { assertEnabled: () => undefined };
  const playability = { assertPlayable: async () => ({ minStake: 1n, maxStake: 1_000n }) };
  const capabilities = new GameCapabilityService(prisma, availability, playability);
  const platform: GamePlatform = {
    capabilities,
    wallet: new GameWalletService(),
    journal: new GameJournalService(prisma),
    rounds: new GameRoundService(prisma),
  };
  const adapter = new CoinFlipAdapter(prisma, platform);

  const scope = `game:${COIN_FLIP_GAME_ID}:play`;
  const issueLaunch = (actor: string) =>
    capabilities.issueLaunch(actor, { gameId: COIN_FLIP_GAME_ID, scope, ttlMs: 60_000, gamePath: '/games/coin-flip/' });
  const exchange = (token: string) =>
    capabilities.exchangeLaunch(token, { gameId: COIN_FLIP_GAME_ID, scope, sessionTtlMs: 3_600_000 });
  // The prepared-outcome journal stores the originating session as a UUID, so
  // the fixture's session identity is a UUID too.
  const FIXTURE_SESSION_ID = '99999999-8888-4777-8666-555555555555';
  const context = (actor: string, sessionId = FIXTURE_SESSION_ID): GameActionContext => ({
    gameId: COIN_FLIP_GAME_ID,
    userId: actor,
    sessionId,
  });
  const flip = (actor: string, choice: string, requestId: string, sessionId = FIXTURE_SESSION_ID) =>
    adapter.execute(context(actor, sessionId), {
      event: 'flip',
      body: { slotEvent: 'flip', choice },
      headers: {},
      requestId,
    });

  const playerEmail = uniqueTestEmail('template-player');
  const rivalEmail = uniqueTestEmail('template-rival');
  const adminEmail = uniqueTestEmail('template-admin');
  let userId: string;
  let rivalId: string;
  let adminId: string;

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "GamePreparedOutcome", "GameSession", "GameLaunchCapability", "CasinoGameConfigVersion", "CasinoGameConfig", "PlatformSettings", "CasinoTransaction", "CasinoRoundAction", "CasinoRound", "CasinoGameFavorite", "LedgerEntry", "BetLeg", "Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE',
    );
    const [player, rival, admin] = await Promise.all([
      prisma.user.create({ data: { email: playerEmail, passwordHash: 'x', wallet: { create: {} } } }),
      prisma.user.create({ data: { email: rivalEmail, passwordHash: 'x', wallet: { create: {} } } }),
      prisma.user.create({ data: { email: adminEmail, passwordHash: 'x', role: 'ADMIN', wallet: { create: {} } } }),
    ]);
    userId = player.id;
    rivalId = rival.id;
    adminId = admin.id;
    await prisma.user.updateMany({ where: { role: 'USER' }, data: { createdById: admin.id } });
  });

  const fund = (amount = 1_000n, target = userId) =>
    points.adminGrant(adminId, target, amount, 'Template fixture funding', `template-fund-${randomUUID()}`);
  const balance = async (target = userId) =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId: target } })).balance;
  const ledger = (target = userId) => prisma.ledgerEntry.findMany({
    where: { wallet: { userId: target }, relatedCasinoRoundId: { not: null } },
  });

  it('keeps the shared layer free of any one game\'s protocol or identity', () => {
    const files = readdirSync(PLATFORM_DIR).filter((file) => file.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(6);
    // Lucky Lady is adapter #1, but the shared layer must not know it: no game
    // id, no native event name and no recovered-client header may appear here.
    const forbidden = [/lucky/i, /luckyLady/i, /slotEvent/i, /slotBet/i, /gambleChoice/i, /x-pilot/i, /responseEvent/i, /serverResponse/i, /BookOfRa/i];
    for (const file of files) {
      const source = readFileSync(join(PLATFORM_DIR, file), 'utf8');
      for (const pattern of forbidden) {
        expect({ file, pattern: String(pattern), match: pattern.test(source) })
          .toEqual({ file, pattern: String(pattern), match: false });
      }
    }
  });

  it('issues one single-use launch capability and never stores the secret', async () => {
    const grant = await issueLaunch(userId);
    expect(grant.token.length).toBeGreaterThanOrEqual(32);
    const rows = await prisma.gameLaunchCapability.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(sha256(grant.token));
    expect(JSON.stringify(rows)).not.toContain(grant.token);
    expect(grant.path).toBe('/launch');
    expect(grant.gamePath).toBe('/games/coin-flip/');

    const session = await exchange(grant.token);
    expect(session.userId).toBe(userId);
    await expect(exchange(grant.token)).rejects.toMatchObject({ response: { code: 'LAUNCH_TOKEN_USED' } });
  });

  it('binds a session to one user and one game', async () => {
    const session = await exchange((await issueLaunch(userId)).token);
    await expect(capabilities.assertSession(session.sessionToken, COIN_FLIP_GAME_ID))
      .resolves.toMatchObject({ userId, sessionId: session.sessionId });
    // The same opaque capability is worthless for another game.
    await expect(capabilities.assertSession(session.sessionToken, 'another-game'))
      .rejects.toMatchObject({ response: { code: 'GAME_SESSION_INVALID' } });
  });

  it('leaves protocol errors to each game while preserving Lucky Lady wire errors', () => {
    const otherProtocol = new HttpException({ fault: 'OTHER_GAME_ERROR' }, 409);
    const generic = GameGatewayBase.prototype as unknown as { asProtocolError(error: unknown): unknown };
    expect(generic.asProtocolError(otherProtocol)).toBe(otherProtocol);
    const native = LuckyLadyController.prototype as unknown as { asProtocolError(error: unknown): HttpException };
    const converted = native.asProtocolError(new HttpException({ message: 'stake rejected', code: 'STAKE' }, 409));
    expect(converted.getStatus()).toBe(409);
    expect(converted.getResponse()).toEqual({ responseEvent: 'error', reason: 'stake rejected', code: 'STAKE' });
    const missingId = native.asProtocolError(new HttpException({ message: 'request rejected' }, 400));
    expect(missingId.getResponse()).toEqual({ responseEvent: 'error', reason: 'request rejected' });
  });

  it('settles a paid round through the authoritative wallet and ledger', async () => {
    await fund();
    const before = await balance();
    const response = await flip(userId, 'heads', 'template-round-1') as {
      serverResponse: { draw: string; payout: number };
    };
    const entries = await ledger();
    expect(entries.filter((entry) => entry.type === 'CASINO_BET')).toHaveLength(1);
    expect(entries.filter((entry) => entry.type === 'CASINO_WIN')).toHaveLength(response.serverResponse.payout > 0 ? 1 : 0);
    // The wallet is exactly explained by the immutable ledger.
    const delta = entries.reduce((sum, entry) => sum + entry.amount, 0n);
    expect(delta).toBe((await balance()) - before);
    expect(delta).toBe(response.serverResponse.payout > 0 ? 1n : -1n);
    const completeLedger = await prisma.ledgerEntry.findMany({ where: { wallet: { userId } } });
    expect(completeLedger.filter((entry) => entry.type === 'ADMIN_GRANT')).toHaveLength(1);
    expect(completeLedger.reduce((sum, entry) => sum + entry.amount, 0n)).toBe(await balance());
  });

  it('replays an identical request and refuses different semantics', async () => {
    await fund();
    const first = await flip(userId, 'heads', 'template-replay-1');
    const replay = await flip(userId, 'heads', 'template-replay-1');
    expect(JSON.stringify(replay)).toBe(JSON.stringify(first));
    expect((await ledger()).filter((entry) => entry.type === 'CASINO_BET')).toHaveLength(1);

    await expect(flip(userId, 'tails', 'template-replay-1'))
      .rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
    expect((await ledger()).filter((entry) => entry.type === 'CASINO_BET')).toHaveLength(1);
  });

  it('settles a durably prepared outcome exactly once, without redrawing', async () => {
    await fund();
    const requestId = 'template-prepared-1';
    const body = { slotEvent: 'flip', choice: 'heads' };
    const canonical = adapter.canonicalizeAction(context(userId), 'flip', body);
    const before = await balance();

    await platform.journal.serialized(COIN_FLIP_GAME_ID, userId, async (tx) => {
      await platform.journal.prepareOutcome(tx, {
        gameId: COIN_FLIP_GAME_ID,
        userId,
        requestKey: platform.journal.requestKey(userId, requestId),
        kind: 'flip',
        canonical,
        sessionId: FIXTURE_SESSION_ID,
        actionId: requestId,
        originRoundId: 'none',
        originVersion: 1,
        originPhase: 'IDLE',
        body,
        // A stored outcome that must be settled as written: heads against heads.
        payload: { roundId: randomUUID(), stake: 1, choice: 'heads', draw: 'heads', payout: 2 },
      });
    });
    expect(await prisma.gamePreparedOutcome.count()).toBe(1);
    expect(await ledger()).toHaveLength(0);
    expect(await balance()).toBe(before);

    await adapter.reconcilePrepared(context(userId));
    expect(await prisma.gamePreparedOutcome.count()).toBe(0);
    expect((await ledger()).map((entry) => entry.type).sort()).toEqual(['CASINO_BET', 'CASINO_WIN']);
    expect(await balance()).toBe(before + 1n);

    // Reconciling again is a no-op: the stored outcome was consumed, not rerun.
    await adapter.reconcilePrepared(context(userId));
    expect(await balance()).toBe(before + 1n);
    expect((await ledger())).toHaveLength(2);
  });

  it('scopes sessions, rounds and actions to their owner', async () => {
    await fund();
    await flip(userId, 'heads', 'template-owner-1');
    const round = await prisma.casinoRound.findFirstOrThrow({ where: { userId } });

    await expect(platform.rounds.ownedRound(rivalId, COIN_FLIP_GAME_ID, round.id))
      .rejects.toMatchObject({ response: { code: 'ROUND_NOT_FOUND' } });
    const mine = await platform.rounds.ownedRound(userId, COIN_FLIP_GAME_ID, round.id);
    expect(mine.id).toBe(round.id);

    const actionId = platform.journal.requestKey(userId, 'template-owner-1');
    const foreign = await platform.journal.acknowledge(COIN_FLIP_GAME_ID, rivalId, actionId);
    expect(foreign.accepted).toBe(false);

    const rivalState = await adapter.read(context(rivalId), 'getState', {}) as {
      recovery: { roundId: string; balance: number };
    };
    expect(rivalState.recovery.roundId).toBe('none');
    expect(rivalState.recovery.balance).toBe(0);
  });
});
