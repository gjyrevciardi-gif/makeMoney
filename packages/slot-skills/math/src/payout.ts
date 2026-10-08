import type { Rational } from "@slot-skills/schema";

export function parseUnits(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`Invalid integer unit value: ${value}`);
  return BigInt(value);
}

export function multiplyRational(units: bigint, rational: Rational): bigint {
  const numerator = parseUnits(rational.numerator);
  const denominator = parseUnits(rational.denominator);
  if (denominator === 0n) throw new Error("Payout denominator cannot be zero");
  const product = units * numerator;
  if (product % denominator !== 0n) throw new Error(`Payout ${rational.numerator}/${rational.denominator} does not divide ${units} exactly`);
  return product / denominator;
}

export function addUnitStrings(...values: string[]): string {
  return values.reduce((total, value) => total + parseUnits(value), 0n).toString();
}
