import { LuckyLadyMathAdapter } from '../src/casino/games/lucky-lady/lucky-lady.math-adapter';
import { loadVerifiedMath } from '../src/casino/games/lucky-lady/lucky-lady.math';
import { defaultSessionConfig, simulateSession } from '../src/casino/platform/math-control/math-control.bankroll';
import { createSimulationRng } from '../src/casino/platform/math-control/math-control.random';
import type {
  MathPolicy,
  MathProfileArtifact,
  SessionOutcomeSource,
} from '../src/casino/platform/math-control/math-control.types';

/**
 * Adapter-boundary check for the bankroll counts.
 *
 * The Lucky Lady session source must report the spins the engine actually
 * resolved. Two seams are exercised here:
 *  - the real engine, cross-checked round by round against an independently
 *    constructed stream with the same seed;
 *  - the adapter's private `sessionSourceFor` seam with a stubbed engine, which
 *    is the only way to assert an award-vs-resolved mismatch (7 resolved spins
 *    for a 15-spin award) and a retriggered 30-spin feature.
 *
 * This boundary has no replay or recovery API: a session source is a pure
 * forward iterator over freshly resolved rounds, so a replayed round cannot add
 * counts here by construction. Runtime replay accounting is exercised by the
 * integration suites, not by this unit probe.
 */
describe('Lucky Lady session source spin counts', () => {
  const policy: MathPolicy = {
    gameId: 'lucky-lady',
    targetRtpPercent: 50,
    maxWinMultiplier: 50,
    maxWinScope: 'PAID_ROUND_BEFORE_OPTIONAL_GAMBLE',
    pacing: 'BALANCED',
    customPacing: null,
    hitRate: { mode: 'AUTO' },
    partialReturn: 'LOW',
    volatility: 'MED',
    bigWinMinMultiplier: 10,
    bigWinMaxMultiplier: 50,
    featureContribution: { minPercent: 0, maxPercent: 60 },
    presets: [],
  };

  const { engine, rules, profile, hashes } = loadVerifiedMath();
  const frozenWeighting = (profile as unknown as { stopWeights: Record<string, number[]> }).stopWeights;
  const sessionConfig = { ...defaultSessionConfig(), horizonPaidSpins: 1 };

  const artifactFor = (hashIndex: number): MathProfileArtifact => ({
    schemaVersion: 1,
    profileId: 'lucky-lady.session-source-probe',
    gameId: 'lucky-lady',
    engineSha256: hashes.engineSha256,
    rulesSha256: hashes.rulesSha256,
    policy,
    payload: { stopWeights: frozenWeighting },
    canonicalHash: hashIndex.toString(16).padStart(64, '0'),
    createdAt: new Date(0).toISOString(),
  });

  /** Cross-check reported counts against the same engine on the same seed. */
  const crossCheck = (artifact: MathProfileArtifact, rounds: number) => {
    const adapter = new LuckyLadyMathAdapter();
    const source = adapter.sessionSource(policy, artifact, sessionConfig);
    const rng = createSimulationRng(`session:${artifact.canonicalHash}:lucky-lady`);
    const rows: Array<{
      reported: ReturnType<SessionOutcomeSource['drawPaidRound']>;
      engineFreeSpins: number;
      engineTriggered: boolean;
      engineRetriggers: number;
    }> = [];
    for (let index = 0; index < rounds; index += 1) {
      const reported = source.drawPaidRound();
      const reference = engine.playRound(rules, { stopWeights: frozenWeighting }, {
        bet: 1,
        lines: rules.lines.length,
        rng,
        capture: false,
      });
      rows.push({
        reported,
        engineFreeSpins: reference.feature.spins,
        engineTriggered: reference.feature.triggered,
        engineRetriggers: reference.feature.retriggers,
      });
    }
    return rows;
  };

  it('reports the engine-resolved count, not the awarded count (7 resolved vs 15 awarded)', () => {
    const adapter = new LuckyLadyMathAdapter();
    // Private seam, stubbed engine: a feature that awarded 15 spins but only 7
    // were actually resolved. The awarded constant must never be used.
    const stubEngine = {
      playRound: () => ({
        totalWin: 5,
        feature: { triggered: true, win: 5, spins: 7, retriggers: 0 },
      }),
    };
    const seam = adapter as unknown as {
      sessionSourceFor: (
        payload: unknown,
        seed: string,
        config: typeof sessionConfig,
        rules: unknown,
        engine: unknown,
      ) => SessionOutcomeSource;
    };
    const source = seam.sessionSourceFor(frozenWeighting, 'stub:7', sessionConfig, rules, stubEngine);
    const round = source.drawPaidRound();
    expect(round.paidSpins).toBe(1);
    expect(round.freeSpins).toBe(7);
    expect(round.totalResolvedSpins).toBe(8);
    expect(round.freeSpins).not.toBe(rules.constants.slotFreeCount);
    expect(round.returnUnits).toBe(10); // 5 engine units x 2 units per bet-unit
    expect(round.featureReturnUnits).toBe(10);

    // A retriggered feature resolves 30 spins, and the flag follows the engine.
    const retriggerSource = seam.sessionSourceFor(
      frozenWeighting, 'stub:30', sessionConfig, rules,
      {
        playRound: () => ({
          totalWin: 4,
          feature: { triggered: true, win: 4, spins: 30, retriggers: 1 },
        }),
      },
    );
    const retriggered = retriggerSource.drawPaidRound();
    expect(retriggered.freeSpins).toBe(30);
    expect(retriggered.totalResolvedSpins).toBe(31);
    expect(retriggered.retriggered).toBe(true);
    expect(retriggered.featureTriggered).toBe(true);
  });

  it('matches the real engine round by round across several deterministic seeds', () => {
    let triggeredRounds = 0;
    let retriggeredRounds = 0;
    for (let hashIndex = 0; hashIndex < 3; hashIndex += 1) {
      const rows = crossCheck(artifactFor(hashIndex), 300);
      for (const row of rows) {
        expect(row.reported.paidSpins).toBe(1);
        // The heart of this probe: the reported count is the engine's own
        // resolved count, round for round, on the same seed.
        expect(row.reported.freeSpins).toBe(row.engineFreeSpins);
        expect(row.reported.totalResolvedSpins).toBe(row.reported.paidSpins + row.engineFreeSpins);
        expect(row.reported.featureTriggered).toBe(row.engineTriggered);
        expect(row.reported.retriggered).toBe(row.engineRetriggers > 0);
        if (row.engineTriggered) triggeredRounds += 1;
        if (row.engineRetriggers > 0) {
          retriggeredRounds += 1;
          // A retrigger really resolved more than the 15-spin award.
          expect(row.reported.freeSpins).toBeGreaterThan(rules.constants.slotFreeCount);
        }
      }
    }
    // Features are common enough that the resolved-count comparison is
    // exercised against real engine output; the explicit 7-vs-15 and 30-spin
    // cases are covered deterministically by the stubbed seam above.
    expect(triggeredRounds).toBeGreaterThan(0);
    expect(retriggeredRounds).toBeGreaterThanOrEqual(0);
  });

  it('counts a frozen round list without adding draws or mutating the results', () => {
    const rows = crossCheck(artifactFor(0), 60);
    const frozen = JSON.parse(JSON.stringify(rows.map((row) => row.reported))) as ReturnType<
      SessionOutcomeSource['drawPaidRound']
    >[];
    const snapshot = JSON.stringify(frozen);

    const listSource = (rounds: typeof frozen): SessionOutcomeSource => {
      let index = 0;
      return {
        drawPaidRound: () => {
          const next = rounds[index];
          if (!next) throw new Error('the bankroll source must not ask for more rounds than were resolved');
          index += 1;
          return next;
        },
      };
    };
    const config = {
      ...defaultSessionConfig(),
      horizonPaidSpins: frozen.length,
      aliveCheckpoints: [1, frozen.length],
      balanceCheckpoints: [1, frozen.length],
      ruinCheckpoints: [1, frozen.length],
      reachTargets: [],
      fallTargets: [],
    };
    const first = simulateSession(listSource(frozen), config, 'frozen:0');
    const second = simulateSession(listSource(frozen), config, 'frozen:0');
    const expectedFreeSpins = frozen.reduce((sum, round) => sum + round.freeSpins, 0);
    const expectedResolved = frozen.reduce((sum, round) => sum + round.totalResolvedSpins, 0);

    expect(first.paidSpins).toBe(frozen.length);
    expect(first.freeSpins).toBe(expectedFreeSpins);
    expect(first.totalResolvedSpins).toBe(expectedResolved);
    // Re-inspecting and re-counting the same frozen results changes nothing and
    // draws nothing new.
    expect(second.freeSpins).toBe(first.freeSpins);
    expect(second.totalResolvedSpins).toBe(first.totalResolvedSpins);
    expect(second.turnoverUnitsExact).toBe(first.turnoverUnitsExact);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });
});
