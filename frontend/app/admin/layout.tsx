'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { adminGet } from '../../lib/admin';
import { canAccessAdminUi, hasCapability, type Capability } from '../../lib/capabilities';
import { displayName, formatPoints, roleLabel } from '../../lib/format';
import { useLogout, useSession, useWallet } from '../../lib/queries';

type Item = { href: string; label: string; hint: string; capability?: Capability; badge?: 'security' };

const GROUPS: { title: string; items: Item[] }[] = [
  { title: 'Overview', items: [{ href: '/admin', label: 'Overview', hint: 'Totals and status', capability: 'GAME_ADMIN' }] },
  {
    title: 'People and money',
    items: [
      { href: '/admin/users', label: 'People and PTS', hint: 'Create accounts, move PTS', capability: 'USER_MANAGE' },
      { href: '/admin/security', label: 'Security alerts', hint: 'Every PTS movement and big win', badge: 'security', capability: 'USER_MANAGE' },
    ],
  },
  {
    title: 'Games',
    items: [
      { href: '/admin/casino/math', label: 'Game return (RTP)', hint: 'How much each game pays back', capability: 'GAME_MATH_MANAGE' },
      { href: '/admin/casino/config', label: 'Game settings', hint: 'Turn games on or off, stake limits', capability: 'GAME_ADMIN' },
      { href: '/admin/sports', label: 'Sports', hint: 'Sportsbook operations', capability: 'PLATFORM_MANAGE' },
    ],
  },
  { title: 'Records', items: [{ href: '/admin/audit', label: 'Audit log', hint: 'Who did what, and when', capability: 'AUDIT_VIEW' }] },
  {
    title: 'My account',
    items: [
      { href: '/admin/two-factor', label: 'Google Authenticator', hint: 'Protect your login' },
      { href: '/admin/password', label: 'Change password', hint: 'Your own password' },
    ],
  },
];

/**
 * Shared frame for every admin page: who you are and what you can see, a grouped menu in plain
 * words, and the number of new security alerts. Presentation only. The backend decides every request.
 * Signed-out or non-admin visitors get the page's own access screen without the menu.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const logout = useLogout();
  const wallet = useWallet();
  const role = session.data?.role;
  const isAdmin = canAccessAdminUi(role);

  const unread = useQuery({
    queryKey: ['admin', 'security-unread'],
    enabled: isAdmin,
    refetchInterval: 30_000,
    queryFn: () => adminGet<{ unread: number }>('/admin/security/events?limit=1&unread=true'),
  });

  if (!isAdmin) return <>{children}</>;

  const groups = GROUPS
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.capability || hasCapability(role, item.capability)) }))
    .filter((group) => group.items.length > 0);
  const active = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname.startsWith(href));
  const alerts = unread.data?.unread ?? 0;
  const badge = (item: Item) => (item.badge === 'security' && alerts > 0 ? <span className="ops-badge" aria-label={`${alerts} new`}>{alerts}</span> : null);

  return (
    <div className="ops-frame">
      <header className="ops-topbar">
        <Link className="brand" href="/admin">FOOL&apos;S GOLD <span>Admin</span></Link>
        <span className={`ops-role ${role === 'SUPER_ADMIN' ? 'is-super' : ''}`}>{roleLabel(role)}</span>
        {role === 'MANAGER' && wallet.data && <span className="ops-role">{formatPoints(wallet.data.balance)} PTS</span>}
        <span className="ops-topbar-user">{displayName(session.data)}</span>
        <Link className="ops-link" href="/">Back to the site</Link>
        <button
          type="button"
          className="ops-signout"
          disabled={logout.isPending}
          onClick={() => logout.mutate(undefined, { onSettled: () => { router.push('/'); router.refresh(); } })}
        >
          Sign out
        </button>
      </header>

      <div className="ops-shell">
        <aside className="ops-sidebar" aria-label="Admin navigation">
          {groups.map((group) => (
            <div className="ops-nav-group" key={group.title}>
              <p className="ops-nav-title">{group.title}</p>
              {group.items.map((item) => (
                <Link key={item.href} href={item.href} className="ops-nav-link" aria-current={active(item.href) ? 'page' : undefined}>
                  <span>{item.label}{badge(item)}</span>
                  <small>{item.hint}</small>
                </Link>
              ))}
            </div>
          ))}
          <p className="ops-nav-scope">
            {role === 'SUPER_ADMIN'
              ? 'You see every player, manager and administrator.'
              : role === 'ADMIN'
                ? 'You see and manage the managers you created and their players, and your own players.'
                : 'You see and manage only the players you created. You can give only points an administrator gave you.'}
          </p>
        </aside>

        <div className="ops-body">
          <nav className="ops-section-tabs" aria-label="Admin sections">
            {groups.flatMap((group) => group.items).map((item) => (
              <Link key={item.href} href={item.href} aria-current={active(item.href) ? 'page' : undefined}>
                {item.label}{badge(item)}
              </Link>
            ))}
          </nav>
          {children}
        </div>
      </div>
    </div>
  );
}
