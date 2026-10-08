'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AdminUser,
  adminGet,
  adminSend,
  describeAdminError,
  formatPoints,
  newIdempotencyKey,
} from '../../../lib/admin';

type UserDetail = {
  user: AdminUser & { wallet: { balance: string } | null };
  ledger: { id: string; type: string; amount: string; reason: string; createdAt: string }[];
  sportsBets: { id: string; type: string; status: string; stake: string; createdAt: string }[];
  casinoRounds: {
    roundId: string; gameType: string; gameVersion: string;
    status: string; stake: string; payout: string; createdAt: string;
  }[];
};

/**
 * Player administration.
 *
 * Balances are never assigned directly. Every adjustment is an explicit,
 * audited ledger event, so the ledger always explains every point a wallet
 * holds.
 */
export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<UserDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'denied'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async (term: string) => {
    const query = new URLSearchParams({ limit: '50' });
    if (term.trim()) query.set('search', term.trim());
    const list = await adminGet<AdminUser[]>(`/admin/users?${query.toString()}`);
    if (!list) {
      setState('denied');
      return;
    }
    setUsers(list);
    setState('ready');
  }, []);

  useEffect(() => { void load(''); }, [load]);

  const open = async (id: string) => {
    setError('');
    setNotice('');
    const detail = await adminGet<UserDetail>(`/admin/users/${id}/detail`);
    setSelected(detail);
  };

  const adjust = async (direction: 'grant' | 'remove') => {
    if (!selected) return;
    const value = Number(amount);
    if (!Number.isInteger(value) || value <= 0 || !reason.trim()) {
      setError('Enter a whole number of points and a reason.');
      return;
    }
    const confirmed = window.confirm(
      `${direction === 'grant' ? 'Grant' : 'Remove'} ${formatPoints(value)} points `
      + `${direction === 'grant' ? 'to' : 'from'} ${selected.user.email}?\n\n`
      + 'This writes an immutable ledger entry and is recorded in the audit trail.',
    );
    if (!confirmed) return;

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const path = direction === 'grant'
        ? `/admin/users/${selected.user.id}/coins`
        : `/admin/users/${selected.user.id}/coins/remove`;
      await adminSend(path, 'POST', {
        amount: value,
        reason: reason.trim(),
        idempotencyKey: newIdempotencyKey(),
      });
      setNotice(`${direction === 'grant' ? 'Granted' : 'Removed'} ${formatPoints(value)} points.`);
      setAmount('');
      setReason('');
      await open(selected.user.id);
      await load(search);
    } catch (failure) {
      setError(describeAdminError(failure as { code: string; message: string }));
    } finally {
      setBusy(false);
    }
  };

  if (state === 'denied') {
    return (
      <main className="ops-page ops-centered">
        <div className="ops-denied">
          <p className="ops-kicker">RESTRICTED</p>
          <h1>Administrators only</h1>
          <Link className="ops-link" href="/">Back to the site</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="ops-page">
      <header className="ops-header">
        <div>
          <Link className="brand" href="/">FOOL&apos;S GOLD</Link>
          <span className="ops-divider">/</span>
          <Link href="/admin">Admin</Link>
          <span className="ops-divider">/</span>
          <span>Users</span>
        </div>
        <nav>
          <Link href="/admin/casino/config">Game configuration</Link>
          <Link href="/admin/audit">Audit</Link>
        </nav>
      </header>

      <div className="ops-content">
        <section className="ops-hero">
          <div>
            <p className="ops-kicker">PLAYER ADMINISTRATION</p>
            <h1>Users</h1>
            <p>Balances change only through audited ledger events, never by direct assignment.</p>
          </div>
        </section>

        {error && <p className="ops-alert">{error}</p>}
        {notice && <p className="ops-alert ops-alert-action">{notice}</p>}

        <div className="casino-filters">
          <input
            className="admin-search"
            value={search}
            placeholder="Search by email"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void load(search); }}
          />
          <button className="casino-secondary" onClick={() => void load(search)}>Search</button>
        </div>

        <div className="ops-two-column">
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr><th>Email</th><th>Role</th><th>Balance</th><th>Joined</th></tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr><td className="ops-empty" colSpan={4}>No users found.</td></tr>
                )}
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <button
                        type="button"
                        className="admin-user-select"
                        onClick={() => void open(user.id)}
                      >
                        {user.email}
                      </button>
                    </td>
                    <td><span className="ops-status neutral">{user.role}</span></td>
                    <td>{formatPoints(user.wallet?.balance ?? 0)}</td>
                    <td><small>{new Date(user.createdAt).toLocaleDateString()}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ops-list">
            {!selected && (
              <div className="ops-list-item"><p>Select a user to inspect their wallet.</p></div>
            )}
            {selected && (
              <>
                <div className="ops-list-item">
                  <div className="ops-list-top">
                    <strong>{selected.user.email}</strong>
                    <span className="ops-status neutral">{selected.user.role}</span>
                  </div>
                  <p>Balance <strong>{formatPoints(selected.user.wallet?.balance ?? 0)}</strong> points</p>

                  <h3>Adjust balance</h3>
                  <label className="casino-field">
                    <span>Amount (points)</span>
                    <input
                      inputMode="numeric"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ''))}
                    />
                  </label>
                  <label className="casino-field">
                    <span>Reason</span>
                    <input value={reason} onChange={(event) => setReason(event.target.value)} />
                  </label>
                  <div className="admin-game-actions">
                    <button className="ops-action" disabled={busy} onClick={() => void adjust('grant')}>
                      Grant points
                    </button>
                    <button className="casino-secondary" disabled={busy} onClick={() => void adjust('remove')}>
                      Remove points
                    </button>
                  </div>
                </div>

                <div className="ops-list-item">
                  <h3>Recent ledger</h3>
                  <ul className="casino-history">
                    {selected.ledger.map((entry) => (
                      <li key={entry.id}>
                        <span className={Number(entry.amount) > 0 ? 'good' : 'bad'}>
                          {Number(entry.amount) > 0 ? '+' : ''}{formatPoints(entry.amount)}
                        </span>
                        <span>{entry.type}</span>
                        <span>{entry.reason}</span>
                        <span><small>{new Date(entry.createdAt).toLocaleDateString()}</small></span>
                      </li>
                    ))}
                    {selected.ledger.length === 0 && <li><span>No ledger entries.</span></li>}
                  </ul>
                </div>

                <div className="ops-list-item">
                  <h3>Recent casino rounds</h3>
                  <ul className="casino-history">
                    {selected.casinoRounds.map((round) => (
                      <li key={round.roundId}>
                        <span>{round.gameType}</span>
                        <span>{formatPoints(round.stake)}</span>
                        <span className={Number(round.payout) > 0 ? 'good' : 'bad'}>
                          {formatPoints(round.payout)}
                        </span>
                        <span><small>{round.gameVersion}</small></span>
                      </li>
                    ))}
                    {selected.casinoRounds.length === 0 && <li><span>No rounds played.</span></li>}
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
