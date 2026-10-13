import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PlaceBetDto } from './place-bet.dto';

/** A selection reduced to the fields that are part of the placement contract. */
export type CanonicalSelection = {
  eventId: string;
  sportKey: string;
  marketKey: string;
  selectionKey: string;
  displayedOdds: string | null;
};

/** Deterministic, storage-independent shape of a placement request. */
export type CanonicalPlacement = {
  type: string;
  stake: string;
  selections: CanonicalSelection[];
};

/**
 * Normalized decimal string for a client-supplied price.
 *
 * An absent price stays `null` and is deliberately distinct from a supplied
 * one: whether the caller echoed `displayedOdds` is part of the request, so a
 * replay must supply the same shape. `toFixed()` without a precision argument
 * canonicalizes `2.15`, `2.1500` and `2.15000000` to the same string and never
 * rounds a value into a different one.
 */
const normalizeOdds = (value: string | undefined | null): string | null =>
  value === undefined || value === null ? null : new Prisma.Decimal(value).toFixed();

const selectionIdentity = (selection: CanonicalSelection): string =>
  `${selection.eventId}\u0000${selection.sportKey}\u0000${selection.marketKey}\u0000${selection.selectionKey}`;

/**
 * Canonical form of a placement request.
 *
 * Selection order is not part of the contract: the service treats selections
 * as a set (duplicate logical selections are rejected) and both the accumulated
 * odds and the persisted legs are order-independent. Sorting by the immutable
 * selection identity therefore maps a reordered copy of the same request onto
 * the same form, while any change to the set, to a leg field, to the stake, to
 * the type, or to the presence/value of a supplied price yields a different
 * form. Callers must not treat this as permission to alter selections: a
 * different set is a different form and therefore a conflict.
 */
export const canonicalPlacement = (input: PlaceBetDto): CanonicalPlacement => ({
  type: input.type,
  stake: String(input.stake),
  selections: input.selections
    .map((selection) => ({
      eventId: selection.eventId,
      sportKey: selection.sportKey,
      marketKey: selection.marketKey,
      selectionKey: selection.selectionKey,
      displayedOdds: normalizeOdds(selection.displayedOdds),
    }))
    .sort((a, b) => {
      const left = selectionIdentity(a);
      const right = selectionIdentity(b);
      return left < right ? -1 : left > right ? 1 : 0;
    }),
});

/** Stable SHA-256 fingerprint persisted on a bet and compared on replay. */
export const placementFingerprint = (input: PlaceBetDto): string =>
  createHash('sha256').update(JSON.stringify(canonicalPlacement(input))).digest('hex');

/**
 * True when a placement failed in a way that can mean another request with the
 * same key committed first.
 *
 * Three outcomes look like this from inside a placement transaction, and all
 * three roll that transaction back completely:
 *
 *  - `P2002`: the unique index on `idempotencyKey` rejected our insert because a
 *    committed row with that key already exists;
 *  - `INSUFFICIENT_VIRTUAL_BALANCE`: our conditional wallet debit waited for a
 *    concurrent debit on the same wallet, re-read the committed balance and
 *    updated no rows - which is exactly what a duplicate placement one stake
 *    short of the balance looks like;
 *  - `P2034`: a serializable transaction (or a deadlock) was aborted, so the
 *    concurrent placement that caused the conflict may have committed.
 *
 * The caller must re-read the key and answer through the same replay validator
 * before deciding. Any other failure keeps its own meaning.
 */
export const isConcurrentPlacementAbort = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2002' || error.code === 'P2034';
  }
  if (error instanceof ConflictException) {
    const response = error.getResponse();
    // Nest normalises a string message into `{ message, error, statusCode }`,
    // while this codebase also throws the `{ code, message }` object form, so
    // both spellings are recognised here.
    if (response === 'INSUFFICIENT_VIRTUAL_BALANCE') return true;
    if (typeof response !== 'object' || response === null) return false;
    const detail = response as { code?: unknown; message?: unknown };
    return detail.code === 'INSUFFICIENT_VIRTUAL_BALANCE' || detail.message === 'INSUFFICIENT_VIRTUAL_BALANCE';
  }
  return false;
};
