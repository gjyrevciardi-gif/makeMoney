import express from 'express';
import cors from 'cors';
import {
  BUY_BONUS_COST_MULTIPLIER, STAKE_LEVELS,
  type RoundResponse, type SpinRequest,
} from '../../shared/types.js';
import { playRound } from './engine/playRound.js';
import { Store, DEMO_PLAYER } from './db/store.js';
import { TEST_MODE, VECTORS, rngFor } from './testVectors.js';

const PORT = Number(process.env.PORT ?? 8787);
const DB_FILE = process.env.DB_FILE ?? 'wallet.db';

export function createServer(store: Store) {
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, testMode: TEST_MODE });
  });

  app.get('/api/balance', (_req, res) => {
    res.json({ playerId: DEMO_PLAYER, balance: store.balance(), currency: 'PTS' });
  });

  app.get(['/api/session', '/session'], (_req, res) => {
    res.json({
      playerId: DEMO_PLAYER,
      balance: store.balance(),
      currency: 'PTS',
      stakeLevels: STAKE_LEVELS,
      buyBonusMultiplier: BUY_BONUS_COST_MULTIPLIER,
    });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      stakeLevels: STAKE_LEVELS,
      buyBonusMultiplier: BUY_BONUS_COST_MULTIPLIER,
      testMode: TEST_MODE,
      vectors: TEST_MODE ? Object.keys(VECTORS) : [],
    });
  });

  app.get('/api/ledger', (_req, res) => {
    const events = store.ledger();
    res.json({
      events,
      sum: store.ledgerSum(),
      balance: store.balance(),
      reconciled: store.ledgerSum() + 100_000 === store.balance(),
    });
  });

  /** Replay a settled round (refresh-during-round recovery). */
  app.get('/api/round/:roundId', (req, res) => {
    const rec = store.getRound(req.params.roundId);
    if (!rec) { res.status(404).json({ error: 'NOT_FOUND' }); return; }
    res.json(JSON.parse(rec.responseJson));
  });

  app.post(['/api/buy-bonus', '/buy-bonus'], (req, _res, next) => {
    req.body = { ...req.body, buyBonus: true };
    req.url = '/api/spin';
    next();
  });

  app.post(['/api/spin', '/spin'], (req, res) => {
    const body = req.body as SpinRequest;

    const stake = Number(body?.stake);
    const roundId = String(body?.roundId ?? '');
    const buyBonus = Boolean(body?.buyBonus);

    if (!roundId || roundId.length > 64) {
      res.status(400).json({ error: 'BAD_ROUND_ID' }); return;
    }
    if (!STAKE_LEVELS.includes(stake)) {
      res.status(400).json({ error: 'BAD_STAKE', allowed: STAKE_LEVELS }); return;
    }

    // Idempotency: a replayed roundId returns the stored response, never re-settles.
    const existing = store.getRound(roundId);
    if (existing) {
      res.setHeader('X-Idempotent-Replay', '1');
      res.json(JSON.parse(existing.responseJson));
      return;
    }

    const cost = buyBonus ? stake * BUY_BONUS_COST_MULTIPLIER : stake;
    const costType = buyBonus ? 'BONUS_BUY' as const : 'BET' as const;

    if (store.balance() < cost) {
      res.status(402).json({ error: 'INSUFFICIENT_FUNDS', balance: store.balance(), cost });
      return;
    }

    // TEST_MODE only. Ignored entirely in normal play.
    const { rng, deterministic } = rngFor(TEST_MODE ? body?.testVector : undefined);
    const vectorBuy = TEST_MODE && body?.testVector
      ? (VECTORS[body.testVector]?.buyBonus ?? false)
      : false;

    const outcome = playRound(rng, stake, roundId, buyBonus || vectorBuy);

    try {
      const { response } = store.settleRound({
        roundId,
        stake,
        cost: (buyBonus || vectorBuy) ? stake * BUY_BONUS_COST_MULTIPLIER : stake,
        costType: (buyBonus || vectorBuy) ? 'BONUS_BUY' : 'BET',
        win: outcome.finalWin,
        buildResponse: (balanceAfter): RoundResponse => ({ ...outcome, balanceAfter }),
      });

      if (deterministic) res.setHeader('X-Test-Vector', String(body.testVector));
      res.json(response);
    } catch (e: any) {
      if (e?.code === 'INSUFFICIENT_FUNDS' || e?.message === 'INSUFFICIENT_FUNDS') {
        res.status(402).json({ error: 'INSUFFICIENT_FUNDS', balance: store.balance() });
        return;
      }
      // eslint-disable-next-line no-console
      console.error(e);
      res.status(500).json({ error: 'ROUND_FAILED' });
    }
  });

  return app;
}

// Only listen when run directly, so tests can import createServer cleanly.
const isMain = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isMain) {
  const store = new Store(DB_FILE);
  createServer(store).listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[fools-gold] backend on http://localhost:${PORT}  testMode=${TEST_MODE}`);
  });
}
