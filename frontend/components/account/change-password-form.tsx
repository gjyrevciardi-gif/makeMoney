'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, postJson } from '../../lib/api';
import { MIN_PASSWORD_LENGTH } from '../../lib/credentials';
import { useLogout } from '../../lib/queries';

const MESSAGES: Record<string, string> = {
  CURRENT_PASSWORD_INVALID: 'Your current password is not correct.',
  PASSWORD_UNCHANGED: 'Choose a password different from the current one.',
  PASSWORD_INVALID: `A password is ${MIN_PASSWORD_LENGTH}-128 characters.`,
  RATE_LIMITED: 'Too many attempts. Please wait a minute and try again.',
};

/**
 * Change your own password. On success every session is signed out by the server, so this signs the
 * browser out too and sends the person to the sign-in page with the new password.
 */
export function ChangePasswordForm() {
  const router = useRouter();
  const logout = useLogout();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (next.length < MIN_PASSWORD_LENGTH) { setError(`The new password must be at least ${MIN_PASSWORD_LENGTH} characters.`); return; }
    if (next !== confirm) { setError('The two new passwords do not match.'); return; }
    setBusy(true);
    setError('');
    try {
      await postJson('/users/me/password', { currentPassword: current, newPassword: next });
      setDone(true);
      setCurrent(''); setNext(''); setConfirm('');
      window.setTimeout(() => logout.mutate(undefined, { onSettled: () => { router.push('/login'); router.refresh(); } }), 1800);
    } catch (failure) {
      const api = failure instanceof ApiError ? failure : undefined;
      setError(MESSAGES[api?.code ?? ''] ?? api?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <p className="alert" role="status">Password changed. For your safety you are being signed out. Sign in again with the new password.</p>;
  }

  return (
    <form onSubmit={submit} noValidate style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
      <label className="field">
        <span>Current password</span>
        <input className="input" type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} />
      </label>
      <label className="field">
        <span>New password (at least {MIN_PASSWORD_LENGTH} characters)</span>
        <input className="input" type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} />
      </label>
      <label className="field">
        <span>Repeat the new password</span>
        <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
      </label>
      {error && <p className="alert bad" role="alert">{error}</p>}
      <button className="btn btn-primary" type="submit" disabled={busy || !current || !next || !confirm}>
        {busy ? 'Please wait…' : 'Change password'}
      </button>
      <small>Your administrators are notified that you changed it. They are never shown the new password in the notification.</small>
    </form>
  );
}
