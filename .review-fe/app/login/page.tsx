'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, postJson, refreshAccessToken } from '../../lib/api';
import { qk } from '../../lib/queries';

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'That email and password do not match an account.',
  EMAIL_IN_USE: 'An account already exists for that email.',
  WEAK_PASSWORD: 'Choose a longer password.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
};

/**
 * Sign in / create account.
 *
 * Credentials go straight to the backend, which owns hashing, lockout and the
 * refresh cookie. Nothing about the session is decided here.
 */
export default function LoginPage() {
  const router = useRouter();
  const client = useQueryClient();
  const [mode, setMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'REGISTER') {
        await postJson('/auth/register', { email: email.trim(), password });
        await postJson('/auth/login', { email: email.trim(), password });
      } else {
        await postJson('/auth/login', { email: email.trim(), password });
      }
      // The login response sets the refresh cookie; pull an access token before
      // any authenticated query runs.
      await refreshAccessToken();
      await client.invalidateQueries({ queryKey: qk.session });
      await client.invalidateQueries({ queryKey: qk.wallet });
      router.push('/sports');
      router.refresh();
    } catch (failure) {
      const api = failure instanceof ApiError ? failure : undefined;
      setError(MESSAGES[api?.code ?? ''] ?? api?.message ?? 'Something went wrong. Please try again.');
      if (api?.code === 'EMAIL_IN_USE') setNotice('Try signing in instead.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="panel auth-card">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true" />
          Fool&apos;s Gold Club
        </Link>
        <h1>{mode === 'LOGIN' ? 'Sign in' : 'Create your account'}</h1>
        <p>
          {mode === 'LOGIN'
            ? 'Private free-play club. Virtual points only.'
            : 'New accounts start at exactly zero virtual points. Ask an administrator for a grant.'}
        </p>

        <form onSubmit={submit}>
          <label className="field">
            <span>Email</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              className="input"
              type="password"
              autoComplete={mode === 'LOGIN' ? 'current-password' : 'new-password'}
              required
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {mode === 'REGISTER' && <span className="slip-note">At least 12 characters.</span>}
          </label>

          {error && <p className="alert bad" role="alert">{error}</p>}
          {notice && <p className="slip-note">{notice}</p>}

          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'LOGIN' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="auth-switch">
          {mode === 'LOGIN' ? 'No account yet? ' : 'Already a member? '}
          <button
            type="button"
            onClick={() => { setMode(mode === 'LOGIN' ? 'REGISTER' : 'LOGIN'); setError(''); setNotice(''); }}
          >
            {mode === 'LOGIN' ? 'Create one' : 'Sign in'}
          </button>
        </p>

        <p className="casino-disclaimer">
          Virtual points are non-redeemable and have no cash value.
        </p>
      </div>
    </main>
  );
}
