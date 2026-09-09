import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Verifiable-result engine for our virtual-points games.
 *
 * Scheme (commit -> play -> reveal):
 *
 *  1. At round creation the server draws a 32-byte `serverSeed` from Node's
 *     CSPRNG and publishes only `serverSeedHash = sha256(serverSeed)`.
 *  2. Outcomes are derived deterministically from a byte stream of
 *     HMAC-SHA256(serverSeed, "<domain>|<clientSeed>|<nonce>|<block>") blocks.
 *     The domain string separates games and math versions, so one seed can
 *     never produce correlated outcomes across two different games.
 *  3. Once the round is terminal the `serverSeed` is revealed and anybody can
 *     recompute every byte to confirm both the commitment and the outcome.
 *
 * This is a transparency mechanism for a private free-play game. It is not a
 * certification and must never be described as one.
 *
 * `Math.random()` is never used for an authoritative outcome.
 */

export type FairnessCommitment = { serverSeed: string; serverSeedHash: string };

export type FairnessInput = {
  serverSeed: string;
  domain: string;
  clientSeed: string;
  nonce: number;
};

/**
 * A deterministic, unbounded byte stream keyed by the server seed.
 *
 * Consumers pull uniform integers from it; because every draw advances one
 * shared cursor, a verifier replaying the same inputs sees the same sequence.
 */
export class FairnessStream {
  private buffer: Buffer = Buffer.alloc(0);
  private offset = 0;
  private block = 0;

  constructor(private readonly input: FairnessInput) {}

  private ensure(byteCount: number) {
    while (this.buffer.length - this.offset < byteCount) {
      const next = createHmac('sha256', this.input.serverSeed)
        .update(
          `${this.input.domain}|${this.input.clientSeed}|${this.input.nonce}|${this.block}`,
        )
        .digest();
      this.block += 1;
      this.buffer = Buffer.concat([this.buffer.subarray(this.offset), next]);
      this.offset = 0;
    }
  }

  nextUint32(): number {
    this.ensure(4);
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  /**
   * Uniform integer on [0, bound) via rejection sampling.
   *
   * Taking `u32 % bound` directly would over-represent low residues whenever
   * `bound` does not divide 2^32, so draws at or above the largest exact
   * multiple of `bound` are discarded and redrawn.
   */
  nextBelow(bound: number): number {
    if (!Number.isInteger(bound) || bound < 1) {
      throw new RangeError('bound must be a positive integer');
    }
    if (bound === 1) return 0;
    const limit = Math.floor(0x1_0000_0000 / bound) * bound;
    for (;;) {
      const draw = this.nextUint32();
      if (draw < limit) return draw % bound;
    }
  }
}

/** Raw stream bytes, for games that map bytes directly. */
export function deriveBytes(input: FairnessInput, byteCount: number): Buffer {
  const blocks: Buffer[] = [];
  for (let block = 0; blocks.length * 32 < byteCount; block += 1) {
    blocks.push(
      createHmac('sha256', input.serverSeed)
        .update(`${input.domain}|${input.clientSeed}|${input.nonce}|${block}`)
        .digest(),
    );
  }
  return Buffer.concat(blocks).subarray(0, byteCount);
}

export function uniformIntegers(input: FairnessInput, bound: number, count: number): number[] {
  const stream = new FairnessStream(input);
  return Array.from({ length: count }, () => stream.nextBelow(bound));
}

/**
 * `pick` distinct positions from a board of `size`, by partial Fisher-Yates.
 *
 * Each step draws from a shrinking range, which keeps every combination
 * equally likely. Used for mine placement, where order is irrelevant but
 * distinctness is essential.
 */
export function distinctPositions(input: FairnessInput, size: number, pick: number): number[] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('size must be a positive integer');
  if (!Number.isInteger(pick) || pick < 0) throw new RangeError('pick must be a non-negative integer');
  if (pick > size) throw new RangeError('cannot pick more positions than the board holds');
  const stream = new FairnessStream(input);
  const board = Array.from({ length: size }, (_, index) => index);
  for (let index = 0; index < pick; index += 1) {
    const choice = index + stream.nextBelow(size - index);
    [board[index], board[choice]] = [board[choice], board[index]];
  }
  return board.slice(0, pick).sort((left, right) => left - right);
}

export function hashServerSeed(serverSeed: string) {
  return createHash('sha256').update(serverSeed).digest('hex');
}

@Injectable()
export class CasinoFairnessService {
  /** Fresh commitment for one round; the raw seed stays server-side until settlement. */
  createCommitment(): FairnessCommitment {
    const serverSeed = randomBytes(32).toString('hex');
    return { serverSeed, serverSeedHash: hashServerSeed(serverSeed) };
  }

  /**
   * Client seeds are player-supplied fairness input. They influence the byte
   * stream but never the authority of the result, so an arbitrary string is
   * safe once bounded.
   */
  normalizeClientSeed(clientSeed: string | undefined, fallback: string) {
    const trimmed = (clientSeed ?? '').trim();
    return trimmed.length ? trimmed.slice(0, 128) : fallback;
  }

  stream(input: FairnessInput) {
    return new FairnessStream(input);
  }

  bytes(input: FairnessInput, byteCount: number) {
    return deriveBytes(input, byteCount);
  }

  integers(input: FairnessInput, bound: number, count: number) {
    return uniformIntegers(input, bound, count);
  }

  positions(input: FairnessInput, size: number, pick: number) {
    return distinctPositions(input, size, pick);
  }

  hash(serverSeed: string) {
    return hashServerSeed(serverSeed);
  }

  /** Constant-time commitment check for the public verifier. */
  verifyCommitment(serverSeed: string, serverSeedHash: string) {
    if (!/^[0-9a-f]{64}$/i.test(serverSeedHash)) return false;
    const expected = Buffer.from(hashServerSeed(serverSeed), 'hex');
    const provided = Buffer.from(serverSeedHash, 'hex');
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }
}
