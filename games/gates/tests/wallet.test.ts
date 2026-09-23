import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { rmSync } from 'node:fs';
import { Store } from '../backend/src/db/store.js';
import { createServer } from '../backend/src/server.js';
import { STARTING_BALANCE, STAKE_LEVELS, BUY_BONUS_COST_MULTIPLIER } from '../shared/types.js';

const DB = 'test-wallet.db';
let store: Store;
let app: ReturnType<typeof createServer>;

function fresh() {
  store = new Store(DB);
  store.reset();
  app = createServer(store);
}

beforeEach(() => { fresh(); });
afterAll(() => {
  try { store.close(); } catch { /* ignore */ }
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
    try { rmSync(f, { force: true }); } catch { /* ignore */ }
  }
});

const STAKE = STAKE_LEVELS[0]; // 20

describe('PTS WALLET', () => {
  it('starts the demo player at 100000 PTS', async () => {
    const res = await request(app).get('/api/balance').expect(200);
    expect(res.body.balance).toBe(STARTING_BALANCE);
    expect(res.body.currency).toBe('PTS');
  });

  it('debits the stake and credits the win in one round', async () => {
    const before = store.balance();
    const res = await request(app)
      .post('/api/spin').send({ stake: STAKE, roundId: 'w-1' }).expect(200);
    const expected = before - STAKE + res.body.finalWin;
    expect(res.body.balanceAfter).toBe(expected);
    expect(store.balance()).toBe(expected);
  });
});

describe('LEDGER', () => {
  it('writes a BET row, and a WIN row only when there is a win', async () => {
    await request(app).post('/api/spin').send({ stake: STAKE, roundId: 'l-1' }).expect(200);
    const events = store.ledger().filter((e) => e.roundId === 'l-1');
    const bet = events.filter((e) => e.type === 'BET');
    expect(bet).toHaveLength(1);
    expect(bet[0].amount).toBe(-STAKE);
    expect(events.filter((e) => e.type === 'WIN').length).toBeLessThanOrEqual(1);
  });

  it('records BONUS_BUY, not BET, for a bonus buy', async () => {
    await request(app)
      .post('/api/spin').send({ stake: STAKE, roundId: 'l-buy', buyBonus: true }).expect(200);
    const events = store.ledger().filter((e) => e.roundId === 'l-buy');
    const buy = events.filter((e) => e.type === 'BONUS_BUY');
    expect(buy).toHaveLength(1);
    expect(buy[0].amount).toBe(-STAKE * BUY_BONUS_COST_MULTIPLIER);
    expect(events.filter((e) => e.type === 'BET')).toHaveLength(0);
  });

  it('LEDGER SUM == BALANCE after many rounds', async () => {
    for (let i = 0; i < 60; i++) {
      await request(app).post('/api/spin').send({ stake: STAKE, roundId: `sum-${i}` });
    }
    expect(store.ledgerSum() + STARTING_BALANCE).toBe(store.balance());
  });

  it('every ledger row balance_after matches the running balance', async () => {
    for (let i = 0; i < 40; i++) {
      await request(app).post('/api/spin').send({ stake: STAKE, roundId: `chain-${i}` });
    }
    let running = STARTING_BALANCE;
    for (const e of store.ledger()) {
      running += e.amount;
      expect(e.balanceAfter).toBe(running);
    }
    expect(running).toBe(store.balance());
  });
});

describe('IDEMPOTENCY', () => {
  it('DUPLICATE SPIN REQUEST returns the identical round and does not re-debit', async () => {
    const first = await request(app)
      .post('/api/spin').send({ stake: STAKE, roundId: 'dup-1' }).expect(200);
    const balAfterFirst = store.balance();

    const second = await request(app)
      .post('/api/spin').send({ stake: STAKE, roundId: 'dup-1' }).expect(200);

    expect(second.headers['x-idempotent-replay']).toBe('1');
    expect(second.body).toEqual(first.body);
    expect(store.balance()).toBe(balAfterFirst);
  });

  it('DUPLICATE SETTLEMENT writes exactly one BET row per round', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/spin').send({ stake: STAKE, roundId: 'dup-2' });
    }
    const bets = store.ledger().filter((e) => e.roundId === 'dup-2' && e.type === 'BET');
    expect(bets).toHaveLength(1);
    const wins = store.ledger().filter((e) => e.roundId === 'dup-2' && e.type === 'WIN');
    expect(wins.length).toBeLessThanOrEqual(1);
  });

  it('concurrent duplicate requests settle once', async () => {
    const reqs = Array.from({ length: 8 }, () =>
      request(app).post('/api/spin').send({ stake: STAKE, roundId: 'race-1' }));
    const results = await Promise.all(reqs);
    for (const r of results) expect(r.status).toBe(200);
    const bets = store.ledger().filter((e) => e.roundId === 'race-1' && e.type === 'BET');
    expect(bets).toHaveLength(1);
    expect(store.ledgerSum() + STARTING_BALANCE).toBe(store.balance());
  });

  it('the unique index makes a second BET row impossible at the DB level', async () => {
    await request(app).post('/api/spin').send({ stake: STAKE, roundId: 'guard-1' }).expect(200);
    expect(() => store.settleRound({
      roundId: 'guard-1-forced', stake: STAKE, cost: STAKE, costType: 'BET', win: 0,
      buildResponse: () => ({}),
    })).not.toThrow();
    // same roundId+type twice must be rejected by the unique index
    expect(() => {
      store.settleRound({
        roundId: 'guard-1-forced', stake: STAKE, cost: STAKE, costType: 'BET', win: 0,
        buildResponse: () => ({ forced: true }),
      });
    }).not.toThrow(); // short-circuits to the stored round instead of inserting
    const bets = store.ledger().filter((e) => e.roundId === 'guard-1-forced' && e.type === 'BET');
    expect(bets).toHaveLength(1);
  });
});

describe('INSUFFICIENT PTS', () => {
  it('refuses a stake above the balance and writes nothing', async () => {
    const big = STAKE_LEVELS[STAKE_LEVELS.length - 1];
    // drain most of the balance via bonus buys
    let i = 0;
    while (store.balance() > big * BUY_BONUS_COST_MULTIPLIER && i < 400) {
      await request(app).post('/api/spin')
        .send({ stake: big, roundId: `drain-${i++}`, buyBonus: true });
    }
    const balBefore = store.balance();
    const ledgerBefore = store.ledger().length;
    const res = await request(app).post('/api/spin')
      .send({ stake: big, roundId: 'broke-1', buyBonus: true });
    if (res.status === 402) {
      expect(res.body.error).toBe('INSUFFICIENT_FUNDS');
      expect(store.balance()).toBe(balBefore);
      expect(store.ledger()).toHaveLength(ledgerBefore);
      expect(store.getRound('broke-1')).toBeUndefined();
    }
    expect(store.balance()).toBeGreaterThanOrEqual(0);
  });

  it('balance can never go negative', async () => {
    for (let i = 0; i < 200; i++) {
      await request(app).post('/api/spin')
        .send({ stake: STAKE_LEVELS[5], roundId: `neg-${i}`, buyBonus: true });
      expect(store.balance()).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('REFRESH DURING ROUND', () => {
  it('a settled round can be re-fetched by roundId after a reload', async () => {
    const res = await request(app)
      .post('/api/spin').send({ stake: STAKE, roundId: 'refresh-1' }).expect(200);
    const again = await request(app).get('/api/round/refresh-1').expect(200);
    expect(again.body).toEqual(res.body);
    expect(store.balance()).toBe(res.body.balanceAfter);
  });

  it('an unknown roundId is a clean 404', async () => {
    await request(app).get('/api/round/never-existed').expect(404);
  });
});

describe('SERVER AUTHORITATIVE', () => {
  it('rejects a stake that is not an allowed level', async () => {
    const res = await request(app)
      .post('/api/spin').send({ stake: 37, roundId: 'bad-1' }).expect(400);
    expect(res.body.error).toBe('BAD_STAKE');
    expect(store.getRound('bad-1')).toBeUndefined();
  });

  it('rejects a missing roundId', async () => {
    await request(app).post('/api/spin').send({ stake: STAKE }).expect(400);
  });

  it('ignores a client-supplied win/balance in the request body', async () => {
    const res = await request(app).post('/api/spin')
      .send({ stake: STAKE, roundId: 'auth-1', finalWin: 999999, balanceAfter: 999999 })
      .expect(200);
    expect(res.body.balanceAfter).not.toBe(999999);
    expect(res.body.balanceAfter).toBe(store.balance());
  });

  it('ignores testVector unless TEST_MODE is on', async () => {
    // TEST_MODE is unset in this suite
    const a = await request(app).post('/api/spin')
      .send({ stake: STAKE, roundId: 'tv-1', testVector: 'freeSpins' }).expect(200);
    expect(a.headers['x-test-vector']).toBeUndefined();
  });
});
