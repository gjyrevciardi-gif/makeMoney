import type {
  BookOfRaGambleAttempt,
  BookOfRaGambleOutcome,
  BookOfRaGameState,
} from '@slot-skills/runtime';

/**
 * Integration-only public gamble projection.
 *
 * The accepted round view publishes the pending gamble (choices, attempts,
 * pending win) but not the result of the choice the player just made, so the
 * cabinet cannot present RED/BLACK/COLLECT without inferring an outcome from
 * the amounts. This projection restates, field by field, only what the engine
 * has already revealed:
 *
 * - `history` is built from `gambleHistory`, which the resolver only appends to
 *   after an attempt has been resolved;
 * - `resolved` is the outcome object `resolveBookOfRaGamble` returned for the
 *   current request, and only when a request resolved one.
 *
 * It never reads `gambleColours` (the pre-drawn ladder for attempts the player
 * has not made yet), the engine continuation, the RNG draws, or any other
 * private state. Every field is copied explicitly, so a field added to the
 * engine later cannot leak through by accident.
 */

export type BookOfRaGambleColour = 'red' | 'black';

export type RevealedGambleAttempt = {
  attempt: number;
  choice: BookOfRaGambleColour;
  winningColour: BookOfRaGambleColour;
  won: boolean;
  pendingWinBefore: string;
  pendingWinAfter: string;
};

export type ResolvedGambleResult = {
  attempt: number;
  choice: BookOfRaGambleColour | 'collect';
  /** The colour revealed by this attempt; null for a collect. */
  winningColour: BookOfRaGambleColour | null;
  /** Whether this attempt won; null for a collect, which neither wins nor loses. */
  won: boolean | null;
  pendingWinBefore: string;
  pendingWinAfter: string;
  /** Amount settled by this attempt; 0 while the ladder continues. */
  settlement: string;
  complete: boolean;
};

export type BookOfRaGambleView = {
  pending: boolean;
  attempts: number;
  maxAttempts: number;
  pendingWin: string;
  /** The attempt this response resolved, or null when nothing was resolved. */
  resolved: ResolvedGambleResult | null;
  /** Already revealed attempts only, oldest first. */
  history: RevealedGambleAttempt[];
};

function colour(value: unknown): BookOfRaGambleColour | null {
  return value === 'red' || value === 'black' ? value : null;
}

function units(value: unknown): string {
  return typeof value === 'string' && /^\d+$/.test(value) ? value : '0';
}

function attempt(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function revealed(entry: BookOfRaGambleAttempt): RevealedGambleAttempt | null {
  const winningColour = colour(entry?.winningColour);
  const choice = colour(entry?.choice);
  if (!winningColour || !choice) return null;
  return {
    attempt: attempt(entry.attempt),
    choice,
    winningColour,
    won: entry.won === true,
    pendingWinBefore: units(entry.pendingWinBefore),
    pendingWinAfter: units(entry.pendingWinAfter),
  };
}

function resolvedResult(outcome: BookOfRaGambleOutcome): ResolvedGambleResult | null {
  const choice = colour(outcome?.choice) ?? (outcome?.choice === 'collect' ? 'collect' : null);
  if (!choice) return null;
  return {
    attempt: attempt(outcome.attempt),
    choice,
    winningColour: colour(outcome.winningColour),
    won: choice === 'collect' ? null : outcome.won === true,
    pendingWinBefore: units(outcome.pendingWinBefore),
    pendingWinAfter: units(outcome.pendingWinAfter),
    settlement: units(outcome.settlement),
    complete: outcome.complete === true,
  };
}

export function projectGamble(
  state: BookOfRaGameState,
  resolved?: BookOfRaGambleOutcome,
): BookOfRaGambleView {
  const history = (state.gambleHistory ?? [])
    .map((entry) => revealed(entry))
    .filter((entry): entry is RevealedGambleAttempt => entry !== null);
  return {
    pending: state.phase === 'GAMBLE_PENDING' && Boolean(state.pendingActionId),
    attempts: attempt(state.gambleAttempts),
    maxAttempts: attempt(state.gambleMaxAttempts),
    pendingWin: units(state.pendingWin),
    resolved: resolved ? resolvedResult(resolved) : null,
    history,
  };
}
