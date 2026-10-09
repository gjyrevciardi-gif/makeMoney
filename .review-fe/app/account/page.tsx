'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '../../components/shell/app-shell';
import { getJson } from '../../lib/api';
import { formatDateTime, formatPoints, humanize } from '../../lib/format';
import { useLogout, useSession, useWallet } from '../../lib/queries';
import { canAccessAdminUi } from '../../lib/capabilities';

type LedgerEntry = {
  id: string;
  type: string;
  amount: string;
  reason: string;
  createdAt: string;
};

/** The player's own account: identity, balance, and how that balance got there. */
export default function AccountPage() {
  const router = useRouter();
  const session = useSession();
  const wallet = useWallet();
  const logout = useLogout();

  const ledger = useQuery({
    queryKey: ['wallet', 'ledger'],
    enabled: Boolean(session.data),
    queryFn: () => getJson<LedgerEntry[]>('/wallet/me/ledger?limit=25'),
  });

  if (!session.isPending && !session.data) {
    return (
      <AppShell>
        <div className="page">
          <div className="empty-state">
            <strong>You are signed out.</strong>
            <span>Sign in to see your account.</span>
            <Link className="btn btn-sm btn-primary" href="/login">Sign in</Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page">
        <div className="page-head">
          <div>
            <p className="kicker">Account</p>
            <h1>{session.data?.email ?? '—'}</h1>
            <p>
              {session.data ? humanize(session.data.role) : ''}
              {session.data ? ` · member since ${formatDateTime(session.data.createdAt)}` : ''}
            </p>
          </div>
          <div className="admin-game-actions">
            {canAccessAdminUi(session.data?.role) && <Link className="btn btn-sm" href="/admin">Admin</Link>}
            <button
              type="button"
              className="btn btn-sm"
              disabled={logout.isPending}
              onClick={() => logout.mutate(undefined, { onSettled: () => { router.push('/'); router.refresh(); } })}
            >
              Sign out
            </button>
          </div>
        </div>

        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <div className="stat">
            <span>Virtual balance</span>
            <strong className="stat-value">{formatPoints(wallet.data?.balance ?? 0)}</strong>
            <small>non-redeemable points</small>
          </div>
          <div className="stat">
            <span>Sportsbook</span>
            <strong className="stat-value"><Link className="ops-link" href="/my-bets">My bets</Link></strong>
          </div>
          <div className="stat">
            <span>Casino</span>
            <strong className="stat-value"><Link className="ops-link" href="/casino/history">Round history</Link></strong>
          </div>
        </div>

        <div className="section-head"><h2>Recent wallet activity</h2><span>Newest first</span></div>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr><th>When</th><th>Type</th><th>Amount</th><th>Reason</th></tr>
            </thead>
            <tbody>
              {ledger.isPending && (
                <tr><td className="ops-empty" colSpan={4}>Loading…</td></tr>
              )}
              {ledger.data?.length === 0 && (
                <tr><td className="ops-empty" colSpan={4}>No wallet activity yet.</td></tr>
              )}
              {ledger.data?.map((entry) => (
                <tr key={entry.id}>
                  <td><small>{formatDateTime(entry.createdAt)}</small></td>
                  <td><span className="ops-status neutral">{humanize(entry.type)}</span></td>
                  <td className={Number(entry.amount) >= 0 ? 'good' : 'bad'}>
                    {Number(entry.amount) > 0 ? '+' : ''}{formatPoints(entry.amount)}
                  </td>
                  <td><small>{entry.reason}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="casino-disclaimer">
          Virtual points are non-redeemable, have no cash value, and cannot be converted into money.
        </p>
      </div>
    </AppShell>
  );
}
