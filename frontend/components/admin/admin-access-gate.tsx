'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { adminGet } from '../../lib/admin';
import { canAccessAdminUi } from '../../lib/capabilities';
import { displayName } from '../../lib/format';
import { useLogout, useSession } from '../../lib/queries';
import { useAuthModal } from '../shell/auth-modal';

const ROLE_LABEL = { USER: 'Player', MANAGER: 'Manager', ADMIN: 'Administrator', SUPER_ADMIN: 'Super administrator' } as const;

/**
 * What an admin page shows when the backend refused it.
 *
 * Presentation only: the backend decided (401/403) and still decides every
 * request. This just explains why and offers the right next step, using the
 * existing login modal and sign-out - no separate auth path.
 *
 *  - signed out            -> admin sign-in prompt (opens the shared login modal)
 *  - signed in, not admin  -> says so, with the account and a sign-out
 *  - admin, wrong area     -> says this role does not include this area
 *
 * After a successful sign-in the page reloads so its own data requests run again
 * under the new session.
 */
export function AdminAccessGate({ area }: { area: string }) {
  const router = useRouter();
  const session = useSession();
  const auth = useAuthModal();
  const logout = useLogout();
  const wasSignedOut = useRef(false);
  const [mfaOff, setMfaOff] = useState(false);

  useEffect(() => {
    if (session.isPending) return;
    if (!session.data) wasSignedOut.current = true;
    else if (wasSignedOut.current) window.location.reload();
  }, [session.isPending, session.data]);

  // An administrator the server turned away may simply not have Google Authenticator on yet.
  useEffect(() => {
    if (!session.data || session.data.role === 'USER') return;
    void adminGet<{ enabled: boolean }>('/auth/2fa/status').then((status) => setMfaOff(status?.enabled === false));
  }, [session.data]);

  const signOut = () =>
    logout.mutate(undefined, { onSettled: () => { router.push('/'); router.refresh(); } });

  if (session.isPending) {
    return (
      <main className="ops-page ops-centered" aria-busy="true">
        <span className="skeleton" style={{ width: 280, height: 120 }} />
      </main>
    );
  }

  if (!session.data) {
    return (
      <main className="ops-page ops-centered">
        <div className="ops-denied">
          <p className="ops-kicker">ADMIN SIGN-IN</p>
          <h1>Sign in to continue</h1>
          <p>{area} is for administrators. Sign in with your administrator account.</p>
          <div className="ops-gate-actions">
            <button type="button" className="ops-action" onClick={() => auth.open()}>Sign in</button>
            <Link className="ops-link" href="/">Back to the site</Link>
          </div>
        </div>
      </main>
    );
  }

  const role = session.data.role;
  const who = displayName(session.data);
  const isAdmin = canAccessAdminUi(role);

  return (
    <main className="ops-page ops-centered">
      <div className="ops-denied">
        <p className="ops-kicker">{isAdmin ? 'RESTRICTED' : 'NO ADMIN ACCESS'}</p>
        <h1>{isAdmin ? 'Your role does not include this area' : 'This account is not an administrator'}</h1>
        <p>
          Signed in as {who} ({ROLE_LABEL[role]}).{' '}
          {isAdmin && mfaOff
            ? 'Turn on Google Authenticator to use the admin tools.'
            : isAdmin
            ? `${area} needs a capability this role does not hold.`
            : 'Ask a super administrator to grant access, or sign in with a different account.'}
        </p>
        <div className="ops-gate-actions">
          <button type="button" className="ops-action" disabled={logout.isPending} onClick={signOut}>
            {logout.isPending ? 'Signing out…' : 'Sign out'}
          </button>
          {isAdmin && mfaOff && <Link className="ops-action" href="/admin/two-factor">Turn on Google Authenticator</Link>}
          <Link className="ops-link" href="/">Back to the site</Link>
        </div>
      </div>
    </main>
  );
}
