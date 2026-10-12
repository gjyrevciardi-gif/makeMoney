'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getJson } from '../../lib/api';
import { canAccessAdminUi } from '../../lib/capabilities';
import { displayName, formatDateTime, formatPoints, humanize, initialOf } from '../../lib/format';
import { useHydrated } from '../../lib/hydrated';
import { useBets } from '../../lib/mobile';
import { useLogout, useSession, useWallet } from '../../lib/queries';
import { IconBets, IconChevron, IconClock, IconShield } from '../shell/icons';

type LedgerEntry = { id: string; type: string; amount: string; reason: string; createdAt: string };
type Period = 'Daily' | 'Weekly' | 'Monthly';

const PERIODS: Period[] = ['Daily', 'Weekly', 'Monthly'];
/** Whole-point choices for the limit preview. */
const AMOUNTS = [500, 1_000, 5_000, 10_000];

const memberSince = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(iso));

function Row({ icon, title, note, href, onClick, disabled }: {
  icon: React.ReactNode; title: string; note?: string; href?: string; onClick?: () => void; disabled?: boolean;
}) {
  const inner = (
    <>
      <span className="m-row-icon" aria-hidden="true">{icon}</span>
      <span className="m-row-text"><b>{title}</b>{note && <small>{note}</small>}</span>
      {disabled ? <em className="m-soon">Not available yet</em> : <IconChevron className="m-row-chevron" />}
    </>
  );
  if (disabled) return <div className="m-acct-row off" aria-disabled="true">{inner}</div>;
  return href
    ? <Link className="m-acct-row" href={href}>{inner}</Link>
    : <button type="button" className="m-acct-row" onClick={onClick}>{inner}</button>;
}

/** Stay in control. The limit UI works on screen, but nothing can be saved or enforced yet. */
function StayInControl() {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<Period>('Daily');
  const [amount, setAmount] = useState<number | null>(null);

  return (
    <section id="limits" className="m-control" aria-labelledby="m-rg">
      <div className="m-control-head">
        <span className="m-control-badge" aria-hidden="true"><IconShield /></span>
        <div><h2 id="m-rg">Stay in control</h2><span>Limits apply to sports and casino.</span></div>
      </div>

      <button type="button" className="m-acct-row" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="m-row-icon accent" aria-hidden="true"><IconClock /></span>
        <span className="m-row-text"><b>Set limits</b><small>No limit set</small></span>
        <IconChevron className={`m-row-chevron${open ? ' open' : ''}`} />
      </button>

      {open && (
        <div className="m-limits">
          <div role="tablist" aria-label="Limit period" className="m-segment three">
            {PERIODS.map((entry) => (
              <button key={entry} type="button" role="tab" aria-selected={period === entry} onClick={() => setPeriod(entry)}>{entry}</button>
            ))}
          </div>
          <div className="m-chips">
            {AMOUNTS.map((value) => (
              <button key={value} type="button" aria-pressed={amount === value} onClick={() => setAmount(value)}>{formatPoints(value)}</button>
            ))}
          </div>
          <p className="m-limit-note">
            {amount ? `${period} stake limit: ${formatPoints(amount)} PTS. ` : ''}
            Saving limits isn&apos;t available yet, so nothing here is stored or enforced.
          </p>
          <button type="button" className="m-place" disabled>Save limit</button>
        </div>
      )}

      <Row icon={<IconClock />} title="Take a break" note="Pause your account from 24 hours to 6 weeks" disabled />
      <Row icon={<IconClock />} title="Reality check" note="A reminder of how long you have played" disabled />
      <Row icon={<IconShield />} title="Self-exclusion" note="Close your account for 6 months or more" disabled />
    </section>
  );
}

export function MobileAccountSkeleton() {
  return (
    <div className="m-account" aria-busy="true" aria-label="Loading account">
      <span className="skeleton m-skel-profile" />
      <span className="skeleton m-skel-balance" />
      <span className="skeleton m-skel-balance" />
    </div>
  );
}

/**
 * The phone Account screen.
 *
 * Identity, balance and wallet activity are what the server reports. "In open
 * bets" adds up the stakes of the open bets that were loaded. The age-verified
 * badge, saved limits, breaks, reality checks and self-exclusion have no data or
 * endpoint yet, so they are not shown as working features.
 */
export function MobileAccount() {
  const hydrated = useHydrated();
  return hydrated ? <AccountScreen /> : <MobileAccountSkeleton />;
}

function AccountScreen() {
  const router = useRouter();
  const session = useSession();
  const wallet = useWallet();
  const logout = useLogout();
  const open = useBets('OPEN');
  const ledger = useQuery({
    queryKey: ['wallet', 'ledger'],
    enabled: Boolean(session.data),
    queryFn: async () => {
      if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_FIXTURES === '1'
        && process.env.NEXT_PUBLIC_DEV_FIXTURE_SESSION === '1') {
        return (await import('../../lib/dev-fixtures')).fixtureLedger();
      }
      return getJson<LedgerEntry[]>('/wallet/me/ledger?limit=25');
    },
  });

  const inOpenBets = useMemo(() => (open.data ?? []).reduce((sum, bet) => sum + Number(bet.stake), 0), [open.data]);

  if (session.isPending) return <MobileAccountSkeleton />;
  if (!session.data) {
    return (
      <div className="empty-state">
        <strong>You are signed out.</strong>
        <span>Sign in to see your account.</span>
        <Link className="btn btn-sm btn-primary" href="/login">Sign in</Link>
      </div>
    );
  }

  const name = displayName(session.data);
  const balance = Number(wallet.data?.balance ?? 0);

  return (
    <div className="m-account">
      <section className="m-profile" aria-label="Profile">
        <span className="m-avatar" aria-hidden="true">{initialOf(name)}</span>
        <div>
          <h1>{name}</h1>
          <span>{humanize(session.data.role)} · member since {memberSince(session.data.createdAt)}</span>
        </div>
      </section>

      <section className="m-balance" aria-label="Balance">
        <div><span>Balance</span><strong>{formatPoints(balance)} PTS</strong></div>
        <div className="m-balance-grid">
          <div><small>Available</small><b>{formatPoints(balance)}</b></div>
          <div><small>In open bets</small><b>{formatPoints(inOpenBets)}</b></div>
        </div>
        <a className="m-acct-row bordered" href="#activity">
          <span className="m-row-icon" aria-hidden="true"><IconBets /></span>
          <span className="m-row-text"><b>Transaction history</b></span>
          <IconChevron className="m-row-chevron" />
        </a>
      </section>

      <StayInControl />

      <nav className="m-settings" aria-label="Account settings">
        <Row icon={<IconBets />} title="My bets" href="/my-bets" />
        <Row icon={<IconClock />} title="Casino round history" href="/casino/history" />
        <Row icon={<IconShield />} title="Change password" href="/account/password" />
        {canAccessAdminUi(session.data.role) && <Row icon={<IconShield />} title="Admin" href="/admin" />}
      </nav>

      <section id="activity" className="m-activity" aria-labelledby="m-activity-title">
        <h2 id="m-activity-title">Recent wallet activity</h2>
        {ledger.isPending && <span className="skeleton m-skel-balance" />}
        {ledger.isError && <p className="m-empty">Wallet activity could not be loaded.</p>}
        {ledger.data?.length === 0 && <p className="m-empty">No wallet activity yet.</p>}
        {ledger.data?.map((entry) => (
          <div key={entry.id} className="m-ledger">
            <span><b>{humanize(entry.type)}</b><small>{entry.reason} · {formatDateTime(entry.createdAt)}</small></span>
            <i className={Number(entry.amount) >= 0 ? 'good' : 'bad'}>{Number(entry.amount) > 0 ? '+' : ''}{formatPoints(entry.amount)}</i>
          </div>
        ))}
      </section>

      <button
        type="button"
        className="m-logout"
        disabled={logout.isPending}
        onClick={() => logout.mutate(undefined, { onSettled: () => { router.push('/'); router.refresh(); } })}
      >
        Log out
      </button>

      <footer className="m-acct-foot">
        <span className="m-age big" role="img" aria-label="18 plus only">18+</span>
        <p>
          PTS are virtual, non-redeemable and have no cash value. Only play what you enjoy.{' '}
          <a href="#limits">Play responsibly</a>
        </p>
      </footer>
    </div>
  );
}
