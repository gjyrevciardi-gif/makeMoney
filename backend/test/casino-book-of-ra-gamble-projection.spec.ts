import {
  createBookOfRaState,
  type BookOfRaGameState,
} from '@slot-skills/runtime';
import { BOOK_OF_RA_GAME_ID, BOOK_OF_RA_PROFILE_ID } from '@slot-skills/math';
import { projectGamble } from '../src/casino/games/book-of-ra/book-of-ra.gamble-projection';

/**
 * The gamble projection is the only place where a resolved RED/BLACK/COLLECT
 * result reaches the cabinet, so these tests pin its two safety properties:
 * the pre-drawn ladder for future attempts never appears, and the attempt a
 * response actually resolved is stated explicitly.
 */
const FINGERPRINT = 'f'.repeat(64);

function baseState(overrides: Partial<BookOfRaGameState> = {}): BookOfRaGameState {
  return {
    ...createBookOfRaState({
      profileId: BOOK_OF_RA_PROFILE_ID,
      profileFingerprint: FINGERPRINT,
      betPerLine: '10',
      activeLines: 10,
    }),
    gameId: BOOK_OF_RA_GAME_ID,
    ...overrides,
  };
}

function arraysIn(value: unknown, found: unknown[][] = []): unknown[][] {
  if (Array.isArray(value)) {
    found.push(value);
    for (const entry of value) arraysIn(entry, found);
  } else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) arraysIn(entry, found);
  }
  return found;
}

describe('Book of Ra public gamble projection', () => {
  const ladder = ['red', 'black', 'black', 'red', 'black'] as const;

  it('never exposes the pre-drawn ladder of attempts the player has not made', () => {
    const state = baseState({
      phase: 'GAMBLE_PENDING',
      pendingActionId: 'round:gamble-feature:1',
      gambleAttempts: 1,
      gambleMaxAttempts: 5,
      pendingWin: '200',
      gambleColours: [...ladder],
      gambleHistory: [
        {
          attempt: 1,
          choice: 'black',
          winningColour: 'black',
          won: true,
          pendingWinBefore: '100',
          pendingWinAfter: '200',
          at: '2026-09-24T00:00:00.000Z',
        },
      ],
    });

    const projection = projectGamble(state);
    const serialized = JSON.stringify(projection);

    expect(Object.keys(projection).sort()).toEqual(
      ['attempts', 'history', 'maxAttempts', 'pending', 'pendingWin', 'resolved'].sort(),
    );
    expect(serialized).not.toContain('gambleColours');
    expect(serialized).not.toContain(JSON.stringify(ladder));
    // Only the revealed history is an array, and it can never be as long as the
    // stored ladder while attempts are outstanding.
    for (const array of arraysIn(projection)) {
      expect(array.length).toBeLessThan(ladder.length);
    }
    expect(projection.resolved).toBeNull();
    expect(projection.pending).toBe(true);
  });

  it('states the resolved attempt identity and its revealed colour explicitly', () => {
    const state = baseState({
      phase: 'GAMBLE_PENDING',
      pendingActionId: 'round:gamble-feature:2',
      gambleAttempts: 2,
      gambleMaxAttempts: 5,
      pendingWin: '400',
      gambleColours: [...ladder],
    });
    const projection = projectGamble(state, {
      roundId: '5c1f5f9e-6d7c-4b8f-9a3d-3f0f6a2f0d21',
      attempt: 2,
      choice: 'black',
      resolved: false,
      winningColour: 'black',
      won: true,
      pendingWinBefore: '200',
      pendingWinAfter: '400',
      settlement: '0',
      attemptsRemaining: 3,
      phase: 'GAMBLE_PENDING',
      complete: false,
    });

    expect(projection.resolved).toEqual({
      attempt: 2,
      choice: 'black',
      winningColour: 'black',
      won: true,
      pendingWinBefore: '200',
      pendingWinAfter: '400',
      settlement: '0',
      complete: false,
    });
    expect(JSON.stringify(projection)).not.toContain('gambleColours');
    expect(JSON.stringify(projection)).not.toContain(JSON.stringify(ladder));
  });

  it('marks a lost attempt as resolved loss with the revealed losing colour', () => {
    const projection = projectGamble(
      baseState({ phase: 'ROUND_COMPLETE', gambleAttempts: 3, gambleMaxAttempts: 5, pendingWin: '0' }),
      {
        roundId: 'round',
        attempt: 3,
        choice: 'red',
        resolved: true,
        winningColour: 'black',
        won: false,
        pendingWinBefore: '400',
        pendingWinAfter: '0',
        settlement: '0',
        attemptsRemaining: 2,
        phase: 'ROUND_COMPLETE',
        complete: true,
      },
    );

    expect(projection.resolved).toEqual({
      attempt: 3,
      choice: 'red',
      winningColour: 'black',
      won: false,
      pendingWinBefore: '400',
      pendingWinAfter: '0',
      settlement: '0',
      complete: true,
    });
    expect(projection.pending).toBe(false);
  });

  it('reports a collect as complete with no colour and no win flag', () => {
    const projection = projectGamble(
      baseState({ phase: 'ROUND_COMPLETE', gambleAttempts: 1, gambleMaxAttempts: 5, pendingWin: '50' }),
      {
        roundId: 'round',
        attempt: 1,
        choice: 'collect',
        resolved: true,
        pendingWinBefore: '50',
        pendingWinAfter: '50',
        settlement: '50',
        attemptsRemaining: 0,
        phase: 'ROUND_COMPLETE',
        complete: true,
      },
    );

    expect(projection.resolved).toEqual({
      attempt: 1,
      choice: 'collect',
      winningColour: null,
      won: null,
      pendingWinBefore: '50',
      pendingWinAfter: '50',
      settlement: '50',
      complete: true,
    });
  });

  it('drops history entries that were never revealed and keeps the rest', () => {
    const state = baseState({
      gambleAttempts: 1,
      gambleMaxAttempts: 5,
      gambleHistory: [
        // A partially written record must never be presented as a revealed card.
        { attempt: 1, choice: 'red', won: false, pendingWinBefore: '10', pendingWinAfter: '0', at: 'now' } as never,
        {
          attempt: 2,
          choice: 'red',
          winningColour: 'red',
          won: true,
          pendingWinBefore: '20',
          pendingWinAfter: '40',
          at: 'now',
        },
      ],
    });

    const projection = projectGamble(state);
    expect(projection.history).toEqual([
      {
        attempt: 2,
        choice: 'red',
        winningColour: 'red',
        won: true,
        pendingWinBefore: '20',
        pendingWinAfter: '40',
      },
    ]);
  });
});
