'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatPoints } from '../../lib/format';
import { useSession, useWallet } from '../../lib/queries';
import { useBetSlip } from '../../lib/bet-slip';
import { BetSlipSheet } from '../sports/bet-slip';
import { useAuthModal } from './auth-modal';
import { IconBets, IconCasino, IconHome, IconLive, IconProfile, IconSearch } from './icons';
import { useLiveCasinoTables, useLiveEventCount, useOpenBetsCount } from '../../lib/mobile';
import { SportsNav } from './sports-nav';
import { UserMenu } from './user-menu';

/** The phone's bottom bar; the desktop header uses the reference labels. */
const MOBILE = [
  { href: '/', label: 'Home', Icon: IconHome },
  { href: '/live', label: 'Live', Icon: IconLive },
  { href: '/my-bets', label: 'My Bets', Icon: IconBets },
  { href: '/casino', label: 'Casino', Icon: IconCasino },
] as const;

const isActive = (pathname: string, href: string) =>
  href === '/' ? pathname === '/' || pathname.startsWith('/sports')
    : pathname === href || pathname.startsWith(`${href}/`);

/**
 * Backend-authoritative balance.
 *
 * Rendered straight from the wallet query, which every wagering action
 * invalidates. Nothing here ever adds or subtracts a local figure.
 */
export function BalanceDisplay() {
  const session = useSession();
  const wallet = useWallet();
  const balance = wallet.data?.balance;
  const previous = useRef(balance);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  // Purely visual: reacts to the server's figure changing, never computes one.
  useEffect(() => {
    const before = previous.current;
    previous.current = balance;
    if (before === undefined || balance === undefined || before === balance) return;
    setFlash(Number(balance) > Number(before) ? 'up' : 'down');
    const timer = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(timer);
  }, [balance]);

  if (!session.data) return null;
  if (wallet.isPending) return <span className="skeleton" style={{ width: 82, height: 30 }} />;

  return (
    <span className={`balance-chip${wallet.isFetching ? ' stale' : ''}${flash ? ` flash-${flash}` : ''}`} title="Virtual PTS - no cash value">
      <b>{formatPoints(wallet.data?.balance ?? 0)}</b>
      <span>PTS</span>
    </span>
  );
}

function TopHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const auth = useAuthModal();

  const focusSearch = () => {
    // The phone Home listens for this and opens its own search field.
    if (!window.dispatchEvent(new CustomEvent('fg:search', { cancelable: true }))) return;
    const field = document.getElementById('ref-search');
    if (field) { field.focus(); field.scrollIntoView({ block: 'center' }); } else router.push('/');
  };

  return (
    <header className="shell-header">
      <Link className="ref-brand" href="/" aria-label="Fool's Gold home">
        Fool&apos;s<b>Gold</b>
      </Link>

      <nav className="shell-nav" aria-label="Primary">
        <Link href="/" aria-current={isActive(pathname, '/') || isActive(pathname, '/my-bets') ? 'page' : undefined}>All Sports</Link>
        <Link href="/live" aria-current={isActive(pathname, '/live') ? 'page' : undefined}>In-Play</Link>
        <Link href="/casino" aria-current={isActive(pathname, '/casino') ? 'page' : undefined}>Casino</Link>
      </nav>

      <div className="shell-header-right">
        <button type="button" className="ref-icon-button" aria-label="Search" onClick={focusSearch}>
          <IconSearch />
        </button>
        <span className="balance-slot">
          <BalanceDisplay />
          {/* On a phone the balance chip opens Account. */}
          {session.data && <Link className="m-only balance-hit" href="/account" aria-label="Balance, open account" />}
        </span>
        {session.isPending && <span className="skeleton" style={{ width: 74, height: 32 }} />}
        {!session.isPending && !session.data && (
          <button type="button" className="ref-pill desk-only" onClick={() => auth.open()}>Log In</button>
        )}
        {session.data && <span className="desk-only"><UserMenu /></span>}
      </div>
    </header>
  );
}

/** Phone only: Sports / Live / Casino / My Bets, scrolling sideways, with the live count. */
function MobileTabs() {
  const pathname = usePathname();
  const live = useLiveEventCount();
  const liveTables = useLiveCasinoTables();

  return (
    <nav className="m-only mobile-tabs" aria-label="Sections">
      <Link href="/" aria-current={isActive(pathname, '/') ? 'page' : undefined}>Sports</Link>
      <Link href="/live" aria-current={isActive(pathname, '/live') ? 'page' : undefined}>
        <span className="mobile-live-dot" aria-hidden="true" />
        Live
        {live !== null && live > 0 && <span className="mobile-live-count">{live}</span>}
      </Link>
      <Link href="/casino" aria-current={isActive(pathname, '/casino') ? 'page' : undefined}>Casino</Link>
      {/* Only offered when the platform actually lists live tables. */}
      {liveTables.length > 0 && <Link href="/casino#live-casino">Live Casino</Link>}
      <Link href="/my-bets" aria-current={isActive(pathname, '/my-bets') ? 'page' : undefined}>My Bets</Link>
    </nav>
  );
}

function MobileBottomNav() {
  const pathname = usePathname();
  const openBets = useOpenBetsCount();
  const live = useLiveEventCount();
  const session = useSession();
  const auth = useAuthModal();

  return (
    <nav className="mobile-nav" aria-label="Primary">
      {MOBILE.map(({ href, label, Icon }) => (
        <Link key={href} href={href} aria-current={isActive(pathname, href) ? 'page' : undefined}>
          <Icon />
          {label}
          {href === '/live' && live !== null && live > 0 && <span className="mobile-live-dot" aria-hidden="true" />}
          {href === '/my-bets' && openBets > 0 && (
            <span className="mobile-nav-count" aria-label={`${openBets} open bets`}>{openBets}</span>
          )}
        </Link>
      ))}
      {session.data ? (
        <Link href="/account" aria-current={isActive(pathname, '/account') ? 'page' : undefined}>
          <IconProfile />
          Account
        </Link>
      ) : (
        <button type="button" onClick={() => auth.open()}>
          <IconProfile />
          Log In
        </button>
      )}
    </nav>
  );
}

/**
 * The one application frame.
 *
 * Sportsbook, casino and my bets all render inside it, so navigation, balance,
 * identity, the login modal and the bet slip drawer are defined exactly once.
 * `sidebar` adds the Trending / Most Used / A-Z column used by the sports pages.
 */
export function AppShell({ children, banner, sidebar = false, bare = false }: {
  children: ReactNode;
  banner?: ReactNode;
  sidebar?: boolean;
  /** Phones only: hide the brand header and section tabs because the page draws its own header. */
  bare?: boolean;
}) {
  const slip = useBetSlip();
  return (
    <div className={`shell${slip.sheetOpen ? ' slip-open' : ''}${bare ? ' m-bare' : ''}`}>
      <TopHeader />
      <MobileTabs />
      {process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_FIXTURES === '1' && (
        <p className="shell-banner dev-fixture" role="status">
          DEV FIXTURE DATA: sports and casino lists are sample data for visual comparison only. Bets cannot be placed.
        </p>
      )}
      {banner}
      <div className={`ref-frame${sidebar ? ' with-sidebar' : ''}`}>
        {sidebar && <Suspense fallback={<aside className="ref-sidebar" aria-busy="true" />}><SportsNav /></Suspense>}
        <main className="shell-main">{children}</main>
      </div>
      <BetSlipSheet />
      <MobileBottomNav />
    </div>
  );
}
