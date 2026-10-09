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
import { AdminAccessGate } from '../../../components/admin/admin-access-gate';
import { hasCapability } from '../../../lib/capabilities';
import { displayName, roleLabel } from '../../../lib/format';
import { useSession, useWallet } from '../../../lib/queries';

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
  const session = useSession();
  const wallet = useWallet();
  const canCreateAdmins = hasCapability(session.data?.role, 'ADMIN_MANAGE');
  const canCreateManagers = hasCapability(session.data?.role, 'MANAGER_MANAGE');
  // An administrator creates points; a manager can only move points they were given.
  const canMint = hasCapability(session.data?.role, 'PLAYER_POINTS_MANAGE');
  const canTransfer = hasCapability(session.data?.role, 'PLAYER_POINTS_TRANSFER');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'USER' | 'MANAGER' | 'ADMIN'>('USER');
  const [created, setCreated] = useState<{ username: string; role: string; generatedPassword?: string } | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const [passwordTo, setPasswordTo] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);
  const [ownerTo, setOwnerTo] = useState('');

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
    // A revealed password never follows you to another user.
    setRevealed(null);
    setPasswordTo('');
    setRenameTo('');
    setOwnerTo('');
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (failure) {
      setError(describeAdminError(failure as { code: string; message: string }));
    } finally {
      setBusy(false);
    }
  };

  const createUser = () => run(async () => {
    const result = await adminSend<{ id: string; username: string; role: string; generatedPassword?: string }>(
      '/admin/users', 'POST',
      {
        username: newUsername.trim(),
        ...(newPassword ? { password: newPassword } : {}),
        ...(canCreateManagers ? { role: newRole } : {}),
      },
    );
    setCreated({ username: result.username, role: result.role, generatedPassword: result.generatedPassword });
    setNewUsername('');
    setNewPassword('');
    await load(search);
  });

  const setUserPassword = () => run(async () => {
    if (!selected) return;
    await adminSend(`/admin/users/${selected.user.id}/password`, 'POST', { password: passwordTo });
    setNotice('Password set. Their active sessions were signed out.');
    setPasswordTo('');
    setRevealed(null);
  });

  const revealPassword = () => run(async () => {
    if (!selected) return;
    const result = await adminSend<{ password: string }>(`/admin/users/${selected.user.id}/password/reveal`, 'POST');
    setRevealed(result.password);
  });

  const assignOwner = () => run(async () => {
    if (!selected || !ownerTo) return;
    await adminSend(`/admin/users/${selected.user.id}/owner`, 'POST', { ownerId: ownerTo });
    setNotice('Player assigned.');
    await open(selected.user.id);
    await load(search);
  });

  const renameUser = () => run(async () => {
    if (!selected) return;
    await adminSend(`/admin/users/${selected.user.id}/username`, 'POST', { username: renameTo.trim() });
    setNotice('Username changed.');
    setRenameTo('');
    await open(selected.user.id);
    await load(search);
  });

  const adjust = async (direction: 'grant' | 'remove' | 'give' | 'take') => {
    if (!selected) return;
    const value = Number(amount);
    if (!Number.isInteger(value) || value <= 0 || !reason.trim()) {
      setError('Enter a whole number of points and a reason.');
      return;
    }
    const verb = { grant: 'Grant', remove: 'Remove', give: 'Give', take: 'Take back' }[direction];
    const preposition = direction === 'grant' || direction === 'give' ? 'to' : 'from';
    const confirmed = window.confirm(
      `${verb} ${formatPoints(value)} points ${preposition} ${displayName(selected.user)}?\n\n`
      + (direction === 'give' || direction === 'take'
        ? 'The points move between your balance and theirs. Nothing is created or destroyed. It is recorded in the audit trail.'
        : 'This writes an immutable ledger entry and is recorded in the audit trail.'),
    );
    if (!confirmed) return;

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const suffix = { grant: '', remove: '/remove', give: '/give', take: '/take' }[direction];
      const path = `/admin/users/${selected.user.id}/coins${suffix}`;
      await adminSend(path, 'POST', {
        amount: value,
        reason: reason.trim(),
        idempotencyKey: newIdempotencyKey(),
      });
      setNotice(`${{ grant: 'Granted', remove: 'Removed', give: 'Gave', take: 'Took back' }[direction]} ${formatPoints(value)} points.`);
      void wallet.refetch();
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

  if (state === 'denied') return <AdminAccessGate area="User administration" />;

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
          <Link href="/admin/security">Security</Link>
          <Link href="/admin/audit">Audit</Link>
        </nav>
      </header>

      <div className="ops-content">
        <section className="ops-hero">
          <div>
            <p className="ops-kicker">PLAYER ADMINISTRATION</p>
            <h1>People and PTS</h1>
            <p>
              Balances change only through audited ledger events, never by direct assignment.
              {canTransfer && wallet.data && <> Your balance: <strong>{formatPoints(wallet.data.balance)} PTS</strong>. You can give only points an administrator gave you.</>}
            </p>
          </div>
        </section>

        <section className="ops-list-item" aria-label="Create user">
          <h3>Create user</h3>
          <p>Accounts are created here only. Leave the password empty to generate one.</p>
          <label className="casino-field">
            <span>Username (3-32: letters, digits, . _ -)</span>
            <input value={newUsername} autoComplete="off" onChange={(event) => setNewUsername(event.target.value)} />
          </label>
          <label className="casino-field">
            <span>Password (optional, 8 or more characters)</span>
            <input value={newPassword} autoComplete="off" onChange={(event) => setNewPassword(event.target.value)} />
          </label>
          {canCreateManagers && (
            <label className="casino-field">
              <span>Role</span>
              <select value={newRole} onChange={(event) => setNewRole(event.target.value as 'USER' | 'MANAGER' | 'ADMIN')}>
                <option value="USER">Player</option>
                <option value="MANAGER">Manager (gives points from their own balance)</option>
                {canCreateAdmins && <option value="ADMIN">Administrator</option>}
              </select>
            </label>
          )}
          <div className="admin-game-actions">
            <button className="ops-action" disabled={busy || newUsername.trim().length < 3} onClick={() => void createUser()}>
              Create user
            </button>
          </div>
          {created && (
            <p className="ops-alert ops-alert-action" role="status">
              Created <strong>{created.username}</strong> ({created.role}).
              {created.generatedPassword && (
                <> Generated password: <code>{created.generatedPassword}</code>. You can show it again later from the user panel.</>
              )}
            </p>
          )}
        </section>

        {error && <p className="ops-alert">{error}</p>}
        {notice && <p className="ops-alert ops-alert-action">{notice}</p>}

        <div className="casino-filters">
          <input
            className="admin-search"
            value={search}
            placeholder="Search by username or email"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void load(search); }}
          />
          <button className="casino-secondary" onClick={() => void load(search)}>Search</button>
        </div>

        <div className="ops-two-column">
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr><th>User</th><th>Role</th><th>Balance</th><th>Joined</th></tr>
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
                        {displayName(user)}
                      </button>
                    </td>
                    <td><span className="ops-status neutral">{roleLabel(user.role)}</span></td>
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
                    <strong>{displayName(selected.user)}</strong>
                    <span className="ops-status neutral">{roleLabel(selected.user.role)}</span>
                  </div>
                  <p>Balance <strong>{formatPoints(selected.user.wallet?.balance ?? 0)}</strong> points</p>

                  {canCreateAdmins && (selected.user.role === 'USER' || selected.user.role === 'MANAGER') && (
                    <>
                      <h3>Owner</h3>
                      <p>
                        Belongs to{' '}
                        <strong>
                          {displayName(users.find((u) => u.id === selected.user.createdById)) === '—'
                            ? 'nobody yet (only you can see this player)'
                            : displayName(users.find((u) => u.id === selected.user.createdById))}
                        </strong>
                      </p>
                      <label className="casino-field">
                        <span>{selected.user.role === 'MANAGER' ? 'Give this manager to administrator' : 'Give this player to a manager or administrator'}</span>
                        <select value={ownerTo} onChange={(event) => setOwnerTo(event.target.value)}>
                          <option value="">Choose…</option>
                          {users.filter((u) => u.id !== selected.user.id && (u.role === 'ADMIN' || u.role === 'SUPER_ADMIN' || (selected.user.role === 'USER' && u.role === 'MANAGER'))).map((u) => (
                            <option key={u.id} value={u.id}>{displayName(u)} ({roleLabel(u.role)})</option>
                          ))}
                        </select>
                      </label>
                      <div className="admin-game-actions">
                        <button className="casino-secondary" disabled={busy || !ownerTo} onClick={() => void assignOwner()}>
                          Assign player
                        </button>
                      </div>
                    </>
                  )}

                  <h3>Account</h3>
                  <label className="casino-field">
                    <span>Username</span>
                    <input value={renameTo} placeholder={selected.user.username ?? 'none yet'} autoComplete="off"
                      onChange={(event) => setRenameTo(event.target.value)} />
                  </label>
                  <div className="admin-game-actions">
                    <button className="casino-secondary" disabled={busy || renameTo.trim().length < 3} onClick={() => void renameUser()}>
                      Change username
                    </button>
                  </div>
                  <label className="casino-field">
                    <span>New password (8 or more characters)</span>
                    <input value={passwordTo} autoComplete="off" onChange={(event) => setPasswordTo(event.target.value)} />
                  </label>
                  <div className="admin-game-actions">
                    <button className="ops-action" disabled={busy || passwordTo.length < 8} onClick={() => void setUserPassword()}>
                      Set password
                    </button>
                    <button className="casino-secondary" disabled={busy} onClick={() => void revealPassword()}>
                      Show password
                    </button>
                  </div>
                  {revealed !== null && (
                    <p className="ops-alert ops-alert-action" role="status">
                      Password: <code>{revealed}</code>{' '}
                      <button type="button" className="ops-link" onClick={() => setRevealed(null)}>Hide</button>
                    </p>
                  )}

                  {(canMint || (canTransfer && selected.user.role === 'USER')) && <h3>{canMint ? 'Adjust balance' : 'Give or take back points'}</h3>}
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
                  {canMint && (
                    <div className="admin-game-actions">
                      <button className="ops-action" disabled={busy} onClick={() => void adjust('grant')}>
                        Grant points
                      </button>
                      <button className="casino-secondary" disabled={busy} onClick={() => void adjust('remove')}>
                        Remove points
                      </button>
                    </div>
                  )}
                  {!canMint && canTransfer && selected.user.role === 'USER' && (
                    <div className="admin-game-actions">
                      <button className="ops-action" disabled={busy} onClick={() => void adjust('give')}>
                        Give from my balance
                      </button>
                      <button className="casino-secondary" disabled={busy} onClick={() => void adjust('take')}>
                        Take back to my balance
                      </button>
                    </div>
                  )}
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
