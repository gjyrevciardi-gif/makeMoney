import { sha256Hex } from '../../platform/math-control/math-control.analytics';
import { createSimulationRng } from '../../platform/math-control/math-control.random';
import {
  createDeterministicMassSelector,
  ordinaryClassForMultiplier,
} from '../../platform/math-control/payout-distribution';
import type {
  PolicyRoundObservation,
  PolicySessionObserver,
} from '../../platform/math-control/payout-policy-bankroll';
import type { SessionConfig, SessionOutcomeSource } from '../../platform/math-control/math-control.types';
import {
  LUCKY_LADY_FEATURE_TRIGGER_SCATTERS,
  selectDistributionOutcome,
  withForcedInitialStops,
  type DistributionSupport,
} from './lucky-lady.distribution';
import type { LlProfilePayload } from './lucky-lady.exact';
import type { EngineModule, RulesTable } from './lucky-lady.math';

/**
 * Offline policy-driven session source for Lucky Lady.
 *
 * One paid round is:
 *   1. draw a payout class from the frozen policy's exact integer weights, then
 *      a real reachable board from that class's pre-draw masses
 *      (`selectDistributionOutcome`, the shared selector used by the runtime);
 *   2. execute that board on the game's own vendored evaluator
 *      (`engine.playRound`), forcing only the initial five stop draws
 *      (`withForcedInitialStops`) so every free spin and retrigger is delegated
 *      to the same native mathematics and the same locked profile;
 *   3. report the engine's own numbers - complete-round return, feature return
 *      and the spins it actually resolved - to the accepted bankroll simulator.
 *
 * Simulation-only denomination: the paid stake is `config.stakeUnits`
 * (20 units = 0.20 PTS) at 2 units per line over 10 lines, so every engine
 * figure is already an exact whole number of simulation units and no scaling
 * rounding exists. The live game ladder is untouched: this module is offline
 * tooling, never a runtime path.
 */

export type PolicySessionSourceArgs = {
  support: DistributionSupport;
  payload: LlProfilePayload;
  config: SessionConfig;
  seed: string;
  rules: RulesTable;
  engine: EngineModule;
  observer?: PolicySessionObserver;
};

const toUnits = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`POLICY_SESSION_${label}_INVALID: ${value}`);
  }
  return value;
};

/** The exact 64-bit-class deterministic selector seed for one session. */
export function selectorSeedFor(seed: string): bigint {
  return BigInt(`0x${sha256Hex(`${seed}:payout-policy-selector`).slice(0, 32)}`);
}

export function policyDistributionSessionSource(args: PolicySessionSourceArgs): SessionOutcomeSource {
  const { support, payload, config, seed, rules, engine, observer } = args;
  const lines = rules.lines.length;
  if (config.stakeUnits % lines !== 0) {
    throw new Error(
      `POLICY_SESSION_UNIT_SCALE_NOT_INTEGRAL: ${config.stakeUnits} units / ${lines} lines is not a whole number`,
    );
  }
  const unitsPerLine = config.stakeUnits / lines;
  if (!Number.isSafeInteger(unitsPerLine) || unitsPerLine <= 0) {
    throw new Error(`POLICY_SESSION_UNIT_SCALE_NOT_INTEGRAL: per-line stake ${unitsPerLine}`);
  }
  const bounds = {
    maxBandMin: support.policy.maxBandMin,
    maxWinMultiplier: support.policy.maxWinMultiplier,
  };
  // Class and member draws come from one deterministic simulation stream per
  // session; the native engine draws from a separate stream so the two are
  // independent by construction.
  const selector = createDeterministicMassSelector(selectorSeedFor(seed));
  const nativeRng = createSimulationRng(`${seed}:native-engine`);
  let index = 0;

  return {
    drawPaidRound() {
      const choice = selectDistributionOutcome(support, selector);
      const round = engine.playRound(rules, payload as never, {
        bet: unitsPerLine,
        lines,
        rng: withForcedInitialStops(nativeRng, payload, choice.stops) as never,
        capture: true,
      });

      const paidUnits = toUnits(round.mainEval.totalWin, 'PAID_UNITS');
      const returnUnits = toUnits(round.totalWin, 'RETURN_UNITS');
      const featureUnits = toUnits(round.feature.win, 'FEATURE_UNITS');
      const freeSpins = toUnits(round.feature.spins, 'FREE_SPINS');
      const totalResolvedSpins = 1 + freeSpins;
      if (!Number.isSafeInteger(totalResolvedSpins)) {
        throw new Error('POLICY_SESSION_RESOLVED_SPIN_COUNT_INVALID');
      }
      const sequence = round.feature.sequence ?? [];
      let maxFreeSpinUnits = 0;
      for (const spin of sequence) {
        const units = toUnits(spin.spinWin, 'FREE_SPIN_UNITS');
        if (units > maxFreeSpinUnits) maxFreeSpinUnits = units;
      }

      const nativeScatterCount = toUnits(round.mainEval.scatterCount, 'SCATTER_COUNT');
      const nativeClass = nativeScatterCount >= LUCKY_LADY_FEATURE_TRIGGER_SCATTERS
        ? 'FEATURE_TRIGGER'
        : ordinaryClassForMultiplier(paidUnits / config.stakeUnits, bounds);

      const observation: PolicyRoundObservation = {
        index,
        selectedClass: choice.class,
        nativeClass,
        nativeScatterCount,
        stops: [...choice.stops],
        paidUnits,
        returnUnits,
        featureUnits,
        maxFreeSpinUnits,
        freeSpins,
        totalResolvedSpins,
        featureTriggered: round.feature.triggered,
        retriggered: round.feature.retriggers > 0,
      };
      index += 1;
      observer?.onPaidRound(observation);

      return {
        returnUnits,
        featureReturnUnits: featureUnits,
        paidSpins: 1,
        freeSpins,
        totalResolvedSpins,
        featureTriggered: round.feature.triggered,
        retriggered: round.feature.retriggers > 0,
      };
    },
  };
}

/** Convenience factory bound to a frozen support, ready for `simulateCohort`. */
export function luckyLadyPolicySessionFactory(args: {
  support: DistributionSupport;
  payload: LlProfilePayload;
  config: SessionConfig;
  rules: RulesTable;
  engine: EngineModule;
}) {
  return (seed: string, observer: PolicySessionObserver): SessionOutcomeSource =>
    policyDistributionSessionSource({ ...args, seed, observer });
}
