'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, postJson, refreshAccessToken } from '../../lib/api';
import { credentialProblem } from '../../lib/credentials';
import { qk } from '../../lib/queries';

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'That username or password is not correct.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  INVALID_MFA_CODE: 'That code is not correct.',
  INVALID_MFA_CHALLENGE: 'That sign-in expired. Enter your password again.',
};

/**
 * Sign in.
 *
 * Accounts are created by an administrator, so there is no sign-up here. The
 * username (or, for older accounts, the email) and password go straight to the
 * backend, which owns hashing, lockout and the refresh cookie. Nothing about the
 * session is decided here.
 */
export default function LoginPage() {
  const router = useRouter();
  const client = useQueryClient();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!mfaToken) {
      const problem = credentialProblem(identifier, password);
      if (problem) { setError(problem); return; }
    } else if (code.trim().length < 6) {
      setError('Enter the 6-digit code from Google Authenticator, or a recovery code.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (mfaToken) {
        await postJson('/auth/login/2fa', { mfaToken, code: code.trim() });
      } else {
        const step = await postJson<{ mfaRequired?: boolean; mfaToken?: string }>('/auth/login', { identifier: identifier.trim(), password });
        if (step?.mfaRequired && step.mfaToken) {
          setMfaToken(step.mfaToken);
          return;
        }
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
      if (api?.code === 'INVALID_MFA_CHALLENGE') { setMfaToken(''); setCode(''); }
      // The server answers every login failure with a bare 401, so say what it means at this step.
      const wrongCredentials = api?.status === 401 && api.code === 'UNAUTHORIZED';
      setError(wrongCredentials ? 'That username or password is not correct.' : MESSAGES[api?.code ?? ''] ?? api?.message ?? 'Something went wrong. Please try again.');
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
        <h1>Sign in</h1>
        <p>Private club. Your account is created by an administrator.</p>

        <form onSubmit={submit} noValidate>
          {mfaToken ? (
            <label className="field">
              <span>Google Authenticator code</span>
              <input
                className="input"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <small>Lost your phone? Enter one of your recovery codes instead.</small>
            </label>
          ) : (
            <>
          <label className="field">
            <span>Username</span>
            <input
              className="input"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
            </>
          )}

          {error && <p className="alert bad" role="alert">{error}</p>}

          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : 'Sign in'}
          </button>
        </form>

        <p className="auth-switch">Forgot your username or password? Contact your administrator.</p>

        <p className="casino-disclaimer">
          PTS are virtual points with no cash value inside the app.
        </p>
      </div>
    </main>
  );
}
