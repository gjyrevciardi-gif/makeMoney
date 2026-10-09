'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ApiError, postJson, refreshAccessToken } from '../../lib/api';
import { qk } from '../../lib/queries';

type Mode = 'LOGIN' | 'REGISTER';
type AuthModalApi = { open: (mode?: Mode) => void };

const AuthModalContext = createContext<AuthModalApi>({ open: () => undefined });
export const useAuthModal = () => useContext(AuthModalContext);

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'That username or email and password do not match an account.',
  EMAIL_IN_USE: 'An account already exists for that email.',
  WEAK_PASSWORD: 'Choose a longer password (at least 12 characters).',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
};

/**
 * Login / join modal.
 *
 * Reuses the existing /auth endpoints exactly as the /login page does: the
 * backend owns hashing, lockout and the refresh cookie. The password lives only
 * in this component's state and is cleared on success and on close.
 */
function AuthModal({ mode, setMode, onClose }: { mode: Mode; setMode: (mode: Mode) => void; onClose: () => void }) {
  const client = useQueryClient();
  const router = useRouter();
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showHelp, setShowHelp] = useState(false);
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
    setBusy(true);
    setError('');
    try {
      const body = { email: identity.trim(), password };
      if (mode === 'REGISTER') await postJson('/auth/register', body);
      await postJson('/auth/login', body);
      await refreshAccessToken();
      await client.invalidateQueries({ queryKey: qk.session });
      await client.invalidateQueries({ queryKey: qk.wallet });
      setPassword('');
      onClose();
      router.refresh();
    } catch (failure) {
      const api = failure instanceof ApiError ? failure : undefined;
      setError(MESSAGES[api?.code ?? ''] ?? api?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="auth-modal" role="dialog" aria-modal="true" aria-label={mode === 'LOGIN' ? 'Log in' : 'Join now'}>
        <form onSubmit={submit}>
          <input
            ref={first}
            type="text"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            placeholder="Username or email address"
            aria-label="Username or email address"
            value={identity}
            onChange={(event) => setIdentity(event.target.value)}
          />
          <input
            type="password"
            autoComplete={mode === 'LOGIN' ? 'current-password' : 'new-password'}
            required
            placeholder="Password"
            aria-label="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'LOGIN' ? 'Log In' : 'Join Now'}
          </button>
        </form>
        <button
          type="button"
          className="auth-link"
          onClick={() => { setMode(mode === 'LOGIN' ? 'REGISTER' : 'LOGIN'); setError(''); }}
        >
          {mode === 'LOGIN' ? 'Join Now' : 'Back to Log In'}
        </button>
        <p className="auth-forgot">
          Forgot your{' '}
          <button type="button" onClick={() => setShowHelp(true)}>Username</button> or{' '}
          <button type="button" onClick={() => setShowHelp(true)}>Password</button>?
        </p>
        {showHelp && (
          <p className="auth-help" role="status">
            There is no self-service reset yet. Ask a club administrator to help you recover access.
          </p>
        )}
        {mode === 'REGISTER' && (
          <p className="auth-help">New accounts start at zero virtual PTS. PTS have no cash value.</p>
        )}
      </div>
    </div>
  );
}

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const open = useCallback((next: Mode = 'LOGIN') => setMode(next), []);
  const close = useCallback(() => setMode(null), []);
  const api = useMemo(() => ({ open }), [open]);

  // `?login=1` / `?join=1` open the modal directly, so the state is linkable for review.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('login') === '1') setMode('LOGIN');
    else if (query.get('join') === '1') setMode('REGISTER');
  }, []);

  return (
    <AuthModalContext.Provider value={api}>
      {children}
      {mode && <AuthModal mode={mode} setMode={setMode} onClose={close} />}
    </AuthModalContext.Provider>
  );
}
