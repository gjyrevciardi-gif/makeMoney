import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 6238 time-based one-time passwords (what Google Authenticator generates): HMAC-SHA1,
 * 30-second steps, 6 digits. Small enough to own rather than depend on.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.toUpperCase().replace(/=+$/, '')) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / TOTP_STEP_SECONDS);

/**
 * The step a code belongs to, or null. One step either side tolerates clock drift, and a step at or
 * before `lastStep` is refused so a code cannot be used twice.
 */
export function matchTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const center = currentStep(now);
  for (const step of [center - 1, center, center + 1]) {
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code)) && (lastStep === null || step > lastStep)) return step;
  }
  return null;
}

export function otpauthUri(label: string, secret: string, issuer: string): string {
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?${params.toString()}`;
}
