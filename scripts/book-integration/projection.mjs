/**
 * Integration-only presentation projection.
 *
 * The accepted UI transport expects a `GameRoundResult`-shaped document, while
 * the accepted Nest Book route answers with `BookOfRaRoundView`. This module
 * renames and re-nests the fields that already exist in that response so the
 * cabinet can render them.
 *
 * What this module must never do:
 * - invent a board, a win, a balance or a payout;
 * - invent a revealed gamble colour, a gamble win/loss flag or a gamble history
 *   (the view publishes none of them: see WORKER-REPORT.md);
 * - derive a gamble outcome from the pending or settled amount.
 *
 * Consequently `events` is always empty. The accepted client treats an empty
 * event list as snapshot recovery and renders the resolved board and counters
 * from `finalGrid` and `featureState.bookOfRa` instead of replaying animation.
 */

/** Engine configuration id carried by the profile the round was played under. */
export const ENGINE_GAME_ID = 'book-of-the-sands';

function unitsString(value) {
  return typeof value === 'string' && /^\d+$/.test(value) ? value : '0';
}

function subtract(left, right) {
  const value = BigInt(unitsString(left)) - BigInt(unitsString(right));
  return value.toString();
}

/**
 * @param {object} view  `BookOfRaRoundView` exactly as the Nest route returned it.
 * @param {{ playerId: string }} context
 */
export function projectRound(view, context = {}, { snapshot = false } = {}) {
  const gamble = view.gamble ?? { history: [], resolved: null };
  const feature = {
    profileId: view.profileId,
    profileFingerprint: view.profileFingerprint,
    phase: view.roundState,
    betPerLine: view.betPerLine,
    totalBet: view.totalBet,
    activeLines: view.activeLines,
    stakeLocked: view.stakeLocked === true,
    specialSymbol: view.specialSymbol ?? undefined,
    expandingReels: Array.isArray(view.expandingReels) ? view.expandingReels : [],
    expandingWin: unitsString(view.expandingWin),
    freeSpinsAwarded: view.freeSpinsAwarded ?? 0,
    freeSpinsRemaining: view.freeSpinsRemaining ?? 0,
    freeSpinsPlayed: view.freeSpinsPlayed ?? 0,
    featureWin: unitsString(view.featureWin),
    pendingWin: unitsString(view.pendingWin),
    gambleAttempts: view.gambleAttempts ?? 0,
    gambleMaxAttempts: view.gambleMaxAttempts ?? 0,
    // Revealed attempts only. The projection the backend publishes never
    // contains the pre-drawn ladder for attempts still to be made.
    ...(gamble.history?.length
      ? {
          gambleHistory: gamble.history.map((entry) => ({
            attempt: entry.attempt,
            choice: entry.choice,
            winningColour: entry.winningColour,
            won: entry.won,
            pendingWinBefore: entry.pendingWinBefore,
            pendingWinAfter: entry.pendingWinAfter,
          })),
        }
      : {}),
  };

  const live = snapshot ? [] : liveEvents(view);

  return {
    roundId: view.roundId ?? '',
    // The accepted cabinet gates its classic gamble presentation on the engine
    // configuration id, which is what the round was actually played under.
    gameId: ENGINE_GAME_ID,
    gameVersion: view.profileId,
    playerId: context.playerId ?? '',
    betUnits: unitsString(view.totalBet),
    totalWinUnits: unitsString(view.winTotal),
    netUnits: subtract(view.winTotal, view.settlement?.wager),
    finalGrid: Array.isArray(view.board) ? view.board : null,
    wins: (view.wins ?? []).map((win) => ({
      evaluator: win.evaluator,
      symbolId: win.symbolId,
      count: win.count,
      ways: win.ways,
      cells: win.cells,
      payoutUnits: unitsString(win.amount),
    })),
    events: gamble.resolved ? [choiceResolvedEvent(gamble.resolved)] : live,
    draws: [],
    featureState: { bookOfRa: feature },
    ...(view.pendingAction ? { pendingAction: view.pendingAction } : {}),
    complete: view.settlement?.settled === true,
    roundState: view.roundState,
    specialSymbol: view.specialSymbol ?? undefined,
    expandingReels: Array.isArray(view.expandingReels) ? view.expandingReels : [],
    expandingWin: unitsString(view.expandingWin),
    totalSpinWin: unitsString(view.winTotal),
    board: Array.isArray(view.board) ? view.board : null,
    settlement: view.settlement,
    idempotent: view.idempotent === true,
  };
}

const SCATTER = 'book-of-ra-scatter';
const EXPANDING = 'book-of-ra-expanding';

/**
 * Live presentation events for one spin.
 *
 * The accepted `#spin` starts its reel animation and only `grid-reveal` settles
 * it, so a live spin must publish at least that event. Every value comes from
 * the accepted round view and its whitelisted `spinPresentation`:
 * the reveal board (before any transformation), the resolved expanding reels,
 * the free-spin index and the engine's own win entries. Nothing is derived from
 * book counts, win amounts or invented increments.
 *
 * Order the engine established: reveal the raw board, pay the regular lines,
 * pay the scatter, transform the expanding reels, pay the expanding win, then
 * announce a retrigger. `reel-transform` comes after the regular and scatter
 * wins because the view's `board` is already the expanded final grid.
 */
function liveEvents(view) {
  const presentation = view.spinPresentation;
  if (!presentation) return [];
  const events = [];
  let sequence = 0;
  const push = (type, data) => events.push({ sequence: (sequence += 1), type, data });
  const wins = Array.isArray(view.wins) ? view.wins : [];
  const winEvent = (win, flags) => ({
    evaluator: win.evaluator,
    symbolId: win.symbolId,
    count: win.count,
    ways: win.ways,
    cells: win.cells,
    payoutUnits: unitsString(win.amount),
    ...flags,
  });

  if (Array.isArray(presentation.board) && presentation.board.length) {
    push('grid-reveal', {
      grid: presentation.board,
      ...(presentation.freeSpinIndex === null ? {} : { freeSpinIndex: presentation.freeSpinIndex }),
    });
  }
  for (const win of wins.filter((entry) => entry.evaluator !== SCATTER && entry.evaluator !== EXPANDING)) {
    push('win', winEvent(win, { regular: true, expanding: false }));
  }
  for (const win of wins.filter((entry) => entry.evaluator === SCATTER)) {
    push('win', winEvent(win, { regular: false, expanding: false, scatterPay: true }));
  }
  const expanding = Array.isArray(view.expandingReels) ? view.expandingReels : [];
  if (expanding.length) {
    push('reel-transform', {
      expandingReels: expanding,
      ...(view.specialSymbol ? { specialSymbol: view.specialSymbol } : {}),
    });
  }
  for (const win of wins.filter((entry) => entry.evaluator === EXPANDING)) {
    push('win', winEvent(win, { regular: false, expanding: true }));
  }
  if (presentation.retriggered > 0) {
    push('feature-start', { featureId: 'retriggering-free-spins', addedSpins: presentation.retriggered });
  }
  return events;
}

/**
 * Restates the backend's resolved attempt as the single event the accepted
 * cabinet reads. Only whitelisted fields travel; the win/loss flag is omitted
 * for a collect, which neither wins nor loses.
 */
function choiceResolvedEvent(resolved) {
  return {
    sequence: 1,
    type: 'choice-resolved',
    data: {
      featureId: 'gamble-feature',
      choiceId: resolved.choice,
      attempt: resolved.attempt,
      ...(resolved.winningColour ? { winningColour: resolved.winningColour } : {}),
      ...(resolved.won === null ? {} : { won: resolved.won }),
      pendingWinUnits: resolved.pendingWinAfter,
      settlementUnits: resolved.complete ? resolved.settlement : '0',
    },
  };
}

/**
 * Refresh projection: the accepted page calls `playResult(state.pendingRound)`
 * on load. There is nothing to present until the server has a board or an open
 * pending action, and presenting an invented empty board would be a lie.
 */
export function projectRefresh(view, context) {
  const hasBoard = Array.isArray(view.board) && view.board.length > 0;
  const hasPendingAction = Boolean(view.pendingAction);
  if (!hasBoard && !hasPendingAction) return { featureState: { bookOfRa: { phase: view.roundState } } };
  // Snapshot only: no win, intro or retrigger replay on a refresh.
  return { pendingRound: projectRound(view, context, { snapshot: true }) };
}
