import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOOK_OF_RA_GAME as game, BOOK_OF_RA_PROFILE as profile, type RngProvider } from "@slot-skills/math";
import { DefaultGameEngine, jurisdictionProfiles } from "@slot-skills/runtime";
import { ReferenceGameHost, ReferenceSqliteStore } from "./index.js";

const losing = ["low-1", "low-2", "low-3", "low-4", "low-5", "high-1", "high-2", "high-3", "high-4", "low-1", "low-2", "low-3", "low-4", "low-5", "high-1"];
function rng(symbols = Array<string>(15).fill("low-5")): RngProvider {
  let index = 0;
  const draws = symbols.map(id => {
    let value = 0;
    for (const symbol of game.symbols) { if (symbol.id === id) return value; value += profile.symbolWeights[symbol.id as keyof typeof profile.symbolWeights]!; }
    throw new Error(id);
  });
  return { id: "book-blocker-test", production: false, async uniformInt(maxExclusive, context) {
    const current = index++;
    return { value: draws[current] ?? 0, maxExclusive, index: current, source: "test", reference: context };
  } };
}
function host(store: ReferenceSqliteStore, symbols?: string[]) {
  return new ReferenceGameHost({ games: [game], providers: { wallet: store, jackpot: store, sessions: store, rounds: store, audit: store }, rng: rng(symbols), now: () => 1000 });
}
function fund(store: ReferenceSqliteStore) {
  store.initializePlayer({ playerId: "p", ageBand: "25+", jurisdiction: game.jurisdiction.profileId, locale: "en" }, "10000");
}
const input = { gameId: game.id, playerId: "p", betUnits: "10", idempotencyKey: "spin", autoplay: true };

describe("Book acceptance blockers", () => {
  it("checks the ten-line total stake before computing or debiting a wager", async () => {
    const store = new ReferenceSqliteStore();
    try {
      fund(store);
      const limit = jurisdictionProfiles[game.jurisdiction.profileId]!.maxStakeUnits({ ageBand: "25+", jurisdiction: game.jurisdiction.profileId });
      await expect(host(store, losing).spin({ ...input, betUnits: (limit / 10n + 1n).toString() })).rejects.toThrow(/Total Book stake/);
      expect(await store.balance("p")).toBe("10000");
      expect(store.db.prepare("SELECT COUNT(*) AS n FROM reservations").get()?.n).toBe(0);
    } finally { store.close(); }
  });
  it("commits one wager for concurrent duplicates across independent SQLite connections", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "book-blocker-")), "existing.sqlite");
    const a = new ReferenceSqliteStore(file), b = new ReferenceSqliteStore(file);
    try {
      fund(a);
      const first = host(a, losing), second = host(b, losing);
      const results = await Promise.all([first.spin(input), second.spin(input)]);
      expect(results[0]!.roundId).toBe(results[1]!.roundId);
      expect(await a.balance("p")).toBe("9900");
      expect(a.db.prepare("SELECT COUNT(*) AS n FROM reservations").get()?.n).toBe(1);
      expect(a.db.prepare("SELECT COUNT(*) AS n FROM rounds").get()?.n).toBe(1);
      await expect(second.spin({ ...input, betUnits: "11" })).rejects.toThrow(/IDEMPOTENCY_KEY_CONFLICT/);
    } finally { a.close(); b.close(); }
  });

  it("rejects a stale concurrent feature-state write before another debit", async () => {
    const store = new ReferenceSqliteStore();
    try {
      fund(store);
      const results = await Promise.allSettled([host(store, losing).spin(input), host(store, losing).spin({ ...input, idempotencyKey: "other" })]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(await store.balance("p")).toBe("9900");
    } finally { store.close(); }
  });

  it("hides future colours, raw draws and private hashes on spin, replay, round and refresh", async () => {
    const store = new ReferenceSqliteStore();
    try {
      fund(store);
      const h = host(store);
      const manual = { ...input, autoplay: false };
      const spin = await h.spin(manual);
      const privateRound = await store.getRound(spin.roundId);
      expect(privateRound!.featureState.bookOfRa!.gambleColours).toHaveLength(5);
      expect(spin.outcomeHash).not.toBe(privateRound!.outcomeHash);
      for (const value of [spin, await h.spin(manual), await h.round(spin.roundId), await h.currentState("p", game.id)]) {
        expect(JSON.stringify(value)).not.toMatch(/gambleColours|gambleColor|book-of-ra:gamble/);
      }
      expect(spin.draws).toEqual([]);
      expect((await h.round(spin.roundId)).draws).toEqual([]);
      const action = { playerId: "p", roundId: spin.roundId, actionId: spin.pendingAction!.id, choiceId: "red", idempotencyKey: "red" };
      const doubled = await h.resolveAction(action);
      expect(JSON.stringify(doubled)).not.toMatch(/gambleColours|gambleColor|book-of-ra:gamble/);
      expect(await h.resolveAction(action)).toEqual(doubled);
    } finally { store.close(); }
  });

  it("settles concurrent duplicate collect once without a second reservation", async () => {
    const store = new ReferenceSqliteStore();
    try {
      fund(store);
      const h = host(store);
      const pending = await h.spin({ ...input, autoplay: false });
      const before = BigInt(await store.balance("p"));
      const action = { playerId: "p", roundId: pending.roundId, actionId: pending.pendingAction!.id, choiceId: "collect", idempotencyKey: "collect" };
      const [a, b] = await Promise.all([h.resolveAction(action), h.resolveAction(action)]);
      expect(a).toEqual(b);
      expect(BigInt(await store.balance("p"))).toBe(before + BigInt(pending.totalWinUnits));
      expect(store.db.prepare("SELECT COUNT(*) AS n FROM reservations").get()?.n).toBe(1);
    } finally { store.close(); }
  });

  it("upgrades a legacy database in place and recovers its unresolved wager after reopening", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "book-upgrade-")), "legacy.sqlite");
    const old = new ReferenceSqliteStore(file);
    fund(old);
    const computation = await new DefaultGameEngine().spin(game, { roundId: "legacy-round", playerId: "p", betUnits: "10" }, rng());
    await old.reserve("p", "legacy-round", "100");
    await old.saveRound(computation.result, computation.continuation);
    await old.saveFeatureState("p", game.id, computation.result.featureState);
    // Exact HEAD schema: no scoped key columns and no pending-round index.
    old.db.exec("DROP TABLE idempotency; CREATE TABLE idempotency (request_key TEXT PRIMARY KEY, result_json TEXT NOT NULL); DROP TABLE open_round;");
    old.db.prepare("INSERT INTO idempotency VALUES (?, ?)").run("old-key", JSON.stringify(computation.result));
    old.close();
    const upgraded = new ReferenceSqliteStore(file);
    try {
      const h = host(upgraded);
      expect(await upgraded.balance("p")).toBe("9900");
      expect((await h.currentState("p", game.id)).pendingRound!.roundId).toBe("legacy-round");
      await expect(h.spin({ ...input, idempotencyKey: "old-key" })).rejects.toThrow(/IDEMPOTENCY_KEY_CONFLICT/);
      const collected = await h.resolveAction({ playerId: "p", roundId: "legacy-round", actionId: computation.continuation!.action.id, choiceId: "collect", idempotencyKey: "new-collect" });
      expect(collected.complete).toBe(true);
      expect(BigInt(await upgraded.balance("p"))).toBe(9900n + BigInt(computation.result.totalWinUnits));
      expect(upgraded.db.prepare("SELECT COUNT(*) AS n FROM idempotency_legacy").get()?.n).toBe(1);
    } finally { upgraded.close(); }
    const reopened = new ReferenceSqliteStore(file);
    try {
      expect(await reopened.getOpenRound("p", game.id)).toBeUndefined();
      expect(reopened.db.prepare("SELECT COUNT(*) AS n FROM reservations").get()?.n).toBe(1);
    } finally { reopened.close(); }
  });

  it("refuses direct runtime spins over a pending gamble", async () => {
    const engine = new DefaultGameEngine();
    const first = await engine.spin(game, { roundId: "pending", playerId: "p", betUnits: "10" }, rng());
    await expect(engine.spin(game, { roundId: "second", playerId: "p", betUnits: "10", featureState: first.result.featureState }, rng())).rejects.toThrow(/pending gamble/);
  });
});
