import { describeUnsolved, normalizeUnsolvedStatus } from '../src/casino/games/lucky-lady/payout/lucky-lady-payout.service';

/**
 * The operator-facing message for an unsolved generation request.
 *
 * Deterministic coverage of both honest branches - a bounded search that ran out
 * is never phrased as mathematical impossibility, and only an explicit
 * INFEASIBLE result says that. No solver, database or simulation is involved.
 */
describe('payout unsolved-status messages', () => {
  it('never phrases a search-exhausted result as infeasible', () => {
    const message = describeUnsolved('SEARCH_EXHAUSTED');
    expect(message).toMatch(/search-space limit/i);
    // It may explicitly disclaim infeasibility, but must not affirm it.
    expect(message).toMatch(/not a statement that the request is mathematically infeasible/i);
    expect(message).not.toBe(describeUnsolved('INFEASIBLE'));
    expect(message).not.toMatch(/proves this request infeasible/i);
  });

  it('states infeasibility only for an explicit INFEASIBLE result', () => {
    expect(describeUnsolved('INFEASIBLE')).toMatch(/infeasible/i);
    expect(describeUnsolved('REJECTED')).not.toMatch(/infeasible/i);
    expect(describeUnsolved('GENERATED')).not.toMatch(/infeasible/i);
  });

  it('normalises unknown statuses to an honest rejection', () => {
    expect(normalizeUnsolvedStatus('SOMETHING_ELSE')).toBe('REJECTED');
    expect(normalizeUnsolvedStatus('SEARCH_EXHAUSTED')).toBe('SEARCH_EXHAUSTED');
    expect(normalizeUnsolvedStatus('INFEASIBLE')).toBe('INFEASIBLE');
  });
});
