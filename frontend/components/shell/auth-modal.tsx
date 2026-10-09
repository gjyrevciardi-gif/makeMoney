'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ApiError, postJson, refreshAccessToken } from '../../lib/api';
import { credentialProblem } from '../../lib/credentials';
import { qk } from '../../lib/queries';

type AuthModalApi = { open: () => void };

const AuthModalContext = createContext<AuthModalApi>({ open: () => undefined });
export const useAuthModal = () => useContext(AuthModalContext);

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'That username or password is not correct.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  INVALID_MFA_CODE: 'That code is not correct.',
  INVALID_MFA_CHALLENGE: 'That sign-in expired. Enter your password again.',
};

/**
 * Login modal.
 *
 * Accounts are created by an administrator, so there is no sign-up here. Reuses the
 * existing /auth endpoint exactly as the /login page does: the backend owns
 * hashing, lockout and the refresh cookie. The password lives only in this
 * component's state and is cleared on success and on close.
 */
function AuthModal({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const router = useRouter();
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!mfaToken) {
      const problem = credentialProblem(identity, password);
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
        const step = await postJson<{ mfaRequired?: boolean; mfaToken?: string }>('/auth/login', { identifier: identity.trim(), password });
        if (step?.mfaRequired && step.mfaToken) {
          setMfaToken(step.mfaToken);
          return;
        }
      }
      await refreshAccessToken();
      await client.invalidateQueries({ queryKey: qk.session });
      await client.invalidateQueries({ queryKey: qk.wallet });
      setPassword('');
      onClose();
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
    <div className="auth-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="auth-modal" role="dialog" aria-modal="true" aria-label="Log in">
        <form onSubmit={submit} noValidate>
          {mfaToken ? (
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Google Authenticator code"
              aria-label="Google Authenticator code"
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          ) : (<>
          <input
            ref={first}
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Username"
            aria-label="Username"
            value={identity}
            onChange={(event) => setIdentity(event.target.value)}
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            aria-label="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          </>)}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : 'Log In'}
          </button>
        </form>
        <p className="auth-forgot">Forgot your username or password? Contact your administrator.</p>
        <p className="auth-help">Accounts are created by an administrator.</p>
      </div>
    </div>
  );
}

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const api = useMemo(() => ({ open }), [open]);

  // `?login=1` opens the modal directly, so the state is linkable for review.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('login') === '1') setIsOpen(true);
  }, []);

  return (
    <AuthModalContext.Provider value={api}>
      {children}
      {isOpen && <AuthModal onClose={close} />}
    </AuthModalContext.Provider>
  );
}
