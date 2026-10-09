'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AdminAccessGate } from '../../../components/admin/admin-access-gate';
import { adminGet, adminSend, describeAdminError } from '../../../lib/admin';
import { useSession } from '../../../lib/queries';

type Status = { enabled: boolean; recoveryCodesLeft: number };
type Setup = { secret: string; otpauthUri: string };

/** Turn on Google Authenticator for the signed-in administrator. */
export default function TwoFactorPage() {
  const session = useSession();
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => setStatus(await adminGet<Status>('/auth/2fa/status')), []);
  useEffect(() => { void load(); }, [load]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await work(); } catch (failure) { setError(describeAdminError(failure as { code: string; message: string })); } finally { setBusy(false); }
  };

  const start = () => run(async () => setSetup(await adminSend<Setup>('/auth/2fa/setup', 'POST')));
  const confirm = () => run(async () => {
    const result = await adminSend<{ recoveryCodes: string[] }>('/auth/2fa/enable', 'POST', { code: code.trim() });
    setRecovery(result.recoveryCodes);
    setSetup(null);
    setCode('');
    await load();
  });

  if (!session.isPending && (!session.data || session.data.role === 'USER')) return <AdminAccessGate area="Google Authenticator" />;

  return (
    <main className="ops-page">
      <header className="ops-header">
        <div>
          <Link className="brand" href="/">FOOL&apos;S GOLD</Link>
          <span className="ops-divider">/</span>
          <Link href="/admin">Admin</Link>
          <span className="ops-divider">/</span>
          <span>Google Authenticator</span>
        </div>
      </header>

      <div className="ops-content">
        <section className="ops-hero">
          <div>
            <p className="ops-kicker">ACCOUNT SECURITY</p>
            <h1>Google Authenticator</h1>
            <p>
              After your password, sign-in asks for a 6-digit code from your phone. Even someone who learns
              your password cannot get in without it.
            </p>
          </div>
        </section>

        {error && <p className="ops-alert">{error}</p>}

        {recovery && (
          <section className="ops-list-item">
            <h3>Save your recovery codes now</h3>
            <p>Each works once if you lose your phone. They are shown only this time. Keep them somewhere safe and offline.</p>
            <ul className="casino-history">{recovery.map((item) => <li key={item}><code>{item}</code></li>)}</ul>
            <div className="admin-game-actions">
              <button className="ops-action" onClick={() => setRecovery(null)}>I saved them</button>
            </div>
          </section>
        )}

        {status?.enabled && !recovery && (
          <section className="ops-list-item">
            <h3>Two-factor is on</h3>
            <p>Recovery codes left: <strong>{status.recoveryCodesLeft}</strong>. If you lose both your phone and the codes, a super administrator can reset it for you.</p>
          </section>
        )}

        {status && !status.enabled && !setup && !recovery && (
          <section className="ops-list-item">
            <h3>Two-factor is off</h3>
            <div className="admin-game-actions">
              <button className="ops-action" disabled={busy} onClick={() => void start()}>Set up Google Authenticator</button>
            </div>
          </section>
        )}

        {setup && (
          <section className="ops-list-item">
            <h3>1. Add the account in the app</h3>
            <p>
              In Google Authenticator tap <strong>+</strong>, then <strong>Enter a setup key</strong>. Name it anything, and
              type this key (time-based):
            </p>
            <p><code>{setup.secret.match(/.{1,4}/g)?.join(' ')}</code></p>
            <p><small>On a phone you can also open <a className="ops-link" href={setup.otpauthUri}>this link</a>.</small></p>
            <h3>2. Enter the code it shows</h3>
            <label className="casino-field">
              <span>6-digit code</span>
              <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} />
            </label>
            <div className="admin-game-actions">
              <button className="ops-action" disabled={busy || code.trim().length !== 6} onClick={() => void confirm()}>Turn on</button>
              <button className="casino-secondary" disabled={busy} onClick={() => { setSetup(null); setCode(''); }}>Cancel</button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
