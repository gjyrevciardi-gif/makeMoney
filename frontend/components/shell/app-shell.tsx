'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { formatPoints } from '../../lib/format';
import { useSession, useWallet } from '../../lib/queries';
import { useBetSlip } from '../../lib/bet-slip';
import { IconBets, IconCasino, IconLive, IconProfile, IconSports } from './icons';
import { UserMenu } from './user-menu';

/** One nav definition drives the desktop header and the mobile bar alike. */
const PRIMARY = [
  { href: '/sports', label: 'Sports', Icon: IconSports },
  { href: '/live', label: 'Live', Icon: IconLive },
  { href: '/casino', label: 'Casino', Icon: IconCasino },
  { href: '/my-bets', label: 'My Bets', Icon: IconBets },
] as const;

const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/**
 * Backend-authoritative balance.
 *
 * Rendered straight from the wallet query, which every wagering action
 * invalidates. Nothing here ever adds or subtracts a local figure.
 */
export function BalanceDisplay() {
  const session = useSession();
  const wallet = useWallet();

  if (!session.data) return null;
  if (wallet.isPending) return <span className="skeleton" style={{ width: 82, height: 30 }} />;

  return (
    <span className={`balance-chip${wallet.isFetching ? ' stale' : ''}`} title="Virtual points - no cash value">
      <b>{formatPoints(wallet.data?.balance ?? 0)}</b>
      <span>pts</span>
    </span>
  );
}

function TopHeader() {
  const pathname = usePathname();
  return (
    <header className="shell-header">
      <Link className="brand" href="/">
        <span className="brand-mark" aria-hidden="true" />
        Fool&apos;s Gold Club
      </Link>

      <nav className="shell-nav" aria-label="Primary">
        {PRIMARY.map(({ href, label }) => (
          <Link key={href} href={href} aria-current={isActive(pathname, href) ? 'page' : undefined}>
            {label}
          </Link>
        ))}
      </nav>

      <div className="shell-header-right">
        <BalanceDisplay />
        <UserMenu />
      </div>
    </header>
  );
}

function MobileBottomNav() {
  const pathname = usePathname();
  const slip = useBetSlip();
  const session = useSession();

  return (
    <nav className="mobile-nav" aria-label="Primary">
      {PRIMARY.map(({ href, label, Icon }) => (
        <Link key={href} href={href} aria-current={isActive(pathname, href) ? 'page' : undefined}>
          <Icon />
          {label}
          {href === '/my-bets' && slip.picks.length > 0 && (
            <span className="mobile-nav-count" aria-hidden="true">{slip.picks.length}</span>
          )}
        </Link>
      ))}
      <Link
        href={session.data ? '/account' : '/login'}
        aria-current={isActive(pathname, '/account') || isActive(pathname, '/login') ? 'page' : undefined}
      >
        <IconProfile />
        {session.data ? 'Profile' : 'Sign in'}
      </Link>
    </nav>
  );
}

/**
 * The one application frame.
 *
 * Sportsbook, casino, my bets and admin all render inside it, so navigation,
 * balance and identity are defined exactly once.
 */
export function AppShell({ children, banner }: { children: ReactNode; banner?: ReactNode }) {
  return (
    <div className="shell">
      <TopHeader />
      {banner}
      <main className="shell-main">{children}</main>
      <MobileBottomNav />
    </div>
  );
}
