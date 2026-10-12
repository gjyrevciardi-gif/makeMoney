import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classicIdentity } from '../src/casino/games/book-of-ra-classic/classic.math-adapter';

/**
 * The Classic engine source is the identity anchor of every Classic profile.
 *
 * `classicIdentity()` hashes this file's own bytes as `engineSha256` and
 * `assertClassicArtifact()` rejects any persisted artifact whose hash differs, so
 * a profile generated in one environment must stay verifiable in another.
 * `backend/nest-cli.json` copies the same file byte-for-byte into the build
 * output, and the accepted Classic validation evidence committed under
 * `artifacts/math-validation/book-of-ra-classic/book-of-ra-classic.g26edd6e7615deeed23ed/validation-1.json`
 * pins `engineSha256 = 34ff3cb1...`, which is the LF hash of this file.
 *
 * That contract only holds while every checkout materialises the same bytes, so
 * `.gitattributes` pins this file to LF. Without that pin a Windows checkout
 * (`core.autocrlf=true`) hashes the CRLF copy and every accepted profile is
 * refused with `CLASSIC_PROFILE_IDENTITY_MISMATCH`.
 *
 * The assertion is made against the real source anchor and a pinned accepted
 * identity, never against the evidence file at runtime: that file is rewritten by
 * the validation suite, so a mismatch there could be masked by the same run.
 */
const ACCEPTED_ENGINE_SHA256 = '34ff3cb1696156e77516f146dbd0cd350f3ffe46459da97f5487140be9bf8f1d';

const ENGINE_SOURCE = join(
  __dirname,
  '..',
  'src',
  'casino',
  'games',
  'book-of-ra-classic',
  'classic.engine.ts',
);

describe('Book of Ra Classic engine identity is checkout-stable', () => {
  it('materialises the hashed engine anchor as LF and hashes to the accepted identity', () => {
    const bytes = readFileSync(ENGINE_SOURCE);

    // A carriage return here means the checkout is not LF, so the live engine
    // would hash differently from the accepted `engineSha256` on this platform.
    expect(bytes.includes(0x0d)).toBe(false);

    // The checked-out bytes hash to the identity the committed accepted profile
    // evidence records, so `assertClassicArtifact` accepts it on this platform.
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(ACCEPTED_ENGINE_SHA256);
    expect(classicIdentity().engineSha256).toBe(ACCEPTED_ENGINE_SHA256);
  });
});
