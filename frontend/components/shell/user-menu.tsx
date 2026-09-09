'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { initialOf } from '../../lib/format';
import { useLogout, useSession } from '../../lib/queries';
import { IconChevron, IconShield } from './icons';

/**
 * Account menu.
 *
 * The admin entry is shown only to an administrator, but that is presentation:
 * every admin route re-checks the role in the database on the server, so typing
 * the URL directly still fails with 403.
 */
export function UserMenu() {
  const session = useSession();
  const logout = useLogout();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (session.isPending) return <span className="skeleton" style={{ width: 74, height: 32 }} />;

  if (!session.data) {
    return <Link className="btn btn-primary btn-sm" href="/login">Sign in</Link>;
  }

  const isAdmin = session.data.role === 'ADMIN';

  return (
    <div className="user-menu" ref={container}>
      <button
        type="button"
        className="user-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar" aria-hidden="true">{initialOf(session.data.email)}</span>
        <IconChevron className="league-chevron" />
        <span className="sr-only">Account menu for {session.data.email}</span>
      </button>

      {open && (
        <div className="user-menu-panel" role="menu">
          <div className="user-menu-id">
            <strong>{session.data.email}</strong>
            <span>{isAdmin ? 'Administrator' : 'Player'}</span>
          </div>
          <Link role="menuitem" href="/my-bets" onClick={() => setOpen(false)}>My bets</Link>
          <Link role="menuitem" href="/casino/history" onClick={() => setOpen(false)}>Casino history</Link>
          {isAdmin && (
            <Link role="menuitem" href="/admin" onClick={() => setOpen(false)}>
              Admin <IconShield className="league-chevron" />
            </Link>
          )}
          <button
            role="menuitem"
            type="button"
            disabled={logout.isPending}
            onClick={() => {
              logout.mutate(undefined, { onSettled: () => { setOpen(false); router.push('/'); router.refresh(); } });
            }}
          >
            {logout.isPending ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}
