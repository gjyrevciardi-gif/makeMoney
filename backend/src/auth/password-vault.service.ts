import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type VaultRecord = { ciphertext: string; iv: string; authTag: string; keyId: string };

const ALGORITHM = 'aes-256-gcm';

const notConfigured = (reason: string) =>
  new ServiceUnavailableException({
    code: 'PASSWORD_VAULT_NOT_CONFIGURED',
    message: `The password vault is not configured (${reason}).`,
  });

function parseKey(raw: string | undefined, label: string): Buffer {
  if (!raw) throw notConfigured(`${label} is not set`);
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw notConfigured(`${label} must be 32 bytes, base64 encoded`);
  return key;
}

/**
 * Shared AES-256-GCM cipher for server-secret columns.
 *
 * RETIRED for passwords (milestone A1): no user password is encrypted or stored
 * anywhere. The only remaining caller is `MfaService`, which uses it to seal a
 * user's TOTP secret into `UserTotp`. The class name and the `PASSWORD_VAULT_*`
 * environment variable names are kept unchanged so the TOTP secrets already in
 * production keep decrypting with the same keys.
 *
 * AES-256-GCM with a fresh random IV for every write; the owning user id is bound
 * in as additional authenticated data, so a ciphertext copied onto another user's
 * row fails to decrypt.
 *
 * The key lives in the process environment (`PASSWORD_VAULT_KEY`, 32 bytes,
 * base64), never in the database or the repo, so a database dump or backup holds
 * only ciphertext. To rotate: set a new `PASSWORD_VAULT_KEY` + `PASSWORD_VAULT_KEY_ID`
 * and keep the old one in `PASSWORD_VAULT_PREVIOUS_KEYS` (JSON `{"<keyId>": "<base64>"}`)
 * until every `UserTotp` row has been rewritten (re-running 2FA setup re-encrypts it).
 *
 * If the key is missing or malformed, every vault operation fails closed with 503
 * rather than silently skipping the cipher. Account creation and password changes
 * never touch this service, so they work without `PASSWORD_VAULT_KEY`; only the
 * MFA enrolment/verify paths require it.
 */
@Injectable()
export class PasswordVaultService {
  private current() {
    return {
      key: parseKey(process.env.PASSWORD_VAULT_KEY, 'PASSWORD_VAULT_KEY'),
      keyId: process.env.PASSWORD_VAULT_KEY_ID || 'v1',
    };
  }

  private keyFor(keyId: string): Buffer {
    const current = this.current();
    if (keyId === current.keyId) return current.key;
    let previous: Record<string, string> = {};
    try {
      previous = JSON.parse(process.env.PASSWORD_VAULT_PREVIOUS_KEYS || '{}') as Record<string, string>;
    } catch {
      throw notConfigured('PASSWORD_VAULT_PREVIOUS_KEYS is not valid JSON');
    }
    return parseKey(previous[keyId], `previous key "${keyId}"`);
  }

  /** Fail fast (503) before any other work when the key is missing or malformed. */
  assertConfigured() {
    this.current();
  }

  encrypt(userId: string, plaintext: string): VaultRecord {
    const { key, keyId } = this.current();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(Buffer.from(userId, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyId,
    };
  }

  /** Throws if the record was tampered with, belongs to another user, or its key is unknown. */
  decrypt(userId: string, record: VaultRecord): string {
    const decipher = createDecipheriv(ALGORITHM, this.keyFor(record.keyId), Buffer.from(record.iv, 'base64'));
    decipher.setAAD(Buffer.from(userId, 'utf8'));
    decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }
}
