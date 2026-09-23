import { randomInt, randomUUID } from "node:crypto";

export interface RngDraw {
  value: number;
  maxExclusive: number;
  index: number;
  source: string;
  reference: string;
}

export interface RngProvider {
  readonly id: string;
  readonly production: boolean;
  uniformInt(maxExclusive: number, context: string): Promise<RngDraw>;
}

function assertRange(maxExclusive: number): void {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x1_0000_0000) {
    throw new Error(`Invalid RNG range: ${maxExclusive}`);
  }
}

export class CryptoRngProvider implements RngProvider {
  readonly id = "node-crypto";
  readonly production = true;
  #draw = 0;

  async uniformInt(maxExclusive: number, context: string): Promise<RngDraw> {
    assertRange(maxExclusive);
    const index = this.#draw++;
    return { value: randomInt(maxExclusive), maxExclusive, index, source: this.id, reference: `${context}:${index}:${randomUUID()}` };
  }
}

export class SeededRngProvider implements RngProvider {
  readonly id = "seeded-xorshift32-test-only";
  readonly production = false;
  #state: number;
  #draw = 0;

  constructor(seed: number) {
    this.#state = (seed >>> 0) || 0x9e3779b9;
  }

  #nextUint32(): number {
    let value = this.#state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.#state = value >>> 0;
    return this.#state;
  }

  async uniformInt(maxExclusive: number, context: string): Promise<RngDraw> {
    assertRange(maxExclusive);
    const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
    let raw = this.#nextUint32();
    while (raw >= limit) raw = this.#nextUint32();
    const index = this.#draw++;
    return { value: raw % maxExclusive, maxExclusive, index, source: this.id, reference: `${context}:${index}` };
  }
}
