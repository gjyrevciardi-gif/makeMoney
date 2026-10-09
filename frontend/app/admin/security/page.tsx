'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AdminAccessGate } from '../../../components/admin/admin-access-gate';
import { adminGet, adminSend, describeAdminError, formatPoints } from '../../../lib/admin';
import { displayName } from '../../../lib/format';

type Who = { id: string; username: string | null; email: string | null; role: string };
type SecurityEvent = {
  id: string;
  type: 'PTS_GRANTED' | 'PTS_REMOVED' | 'BIG_WIN' | 'HUGE_WIN' | 'PASSWORD_CHANGED' | 'PTS_TRANSFERRED' | 'PTS_RECLAIMED';
  severity: 'INFO' | 'WARNING' | 'ALERT';
  amount: string;
  balanceAfter: string | null;
  reason: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  subject: Who;
  actor: Who | null;
};
type EventList = { unread: number; items: SecurityEvent[] };

const TITLE: Record<SecurityEvent['type'], string> = {
  PTS_GRANTED: 'PTS added',
  PTS_REMOVED: 'PTS removed',
  BIG_WIN: 'Big win',
  HUGE_WIN: 'Very big win',
  PASSWORD_CHANGED: 'Password changed',
  PTS_TRANSFERRED: 'PTS given by a manager',
  PTS_RECLAIMED: 'PTS taken back by a manager',
};

function sentence(event: SecurityEvent) {
  const points = `${formatPoints(event.amount)} PTS`;
  const player = displayName(event.subject);
  if (event.type === 'PTS_TRANSFERRED') return `${displayName(event.actor)} (manager) gave ${points} to ${player} from their own balance`;
  if (event.type === 'PTS_RECLAIMED') return `${displayName(event.actor)} (manager) took ${points} back from ${player}`;
  if (event.type === 'PASSWORD_CHANGED') return `${player} changed their own password`;
  if (event.type === 'PTS_GRANTED') return `${displayName(event.actor)} added ${points} to ${player}`;
  if (event.type === 'PTS_REMOVED') return `${displayName(event.actor)} removed ${points} from ${player}`;
  return `${player} won ${points} in a single round`;
}

/**
 * Security notifications: every PTS added or removed, and every large single win.
 * A super administrator sees everything; an administrator sees only their own players.
 */
export default function SecurityPage() {
  const [data, setData] = useState<EventList | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'denied'>('loading');
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const result = await adminGet<EventList>(`/admin/security/events?limit=100${unreadOnly ? '&unread=true' : ''}`);
    if (!result) { setState('denied'); return; }
    setData(result);
    setState('ready');
  }, [unreadOnly]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const acknowledge = async (id: string) => {
    setBusy(id);
    setError('');
    try {
      await adminSend(`/admin/security/events/${id}/acknowledge`, 'POST');
      await load();
    } catch (failure) {
      setError(describeAdminError(failure as { code: string; message: string }));
    } finally {
      setBusy('');
    }
  };

  if (state === 'denied') return <AdminAccessGate area="Security notifications" />;

  return (
    <main className="ops-page">
      <header className="ops-header">
        <div>
          <Link className="brand" href="/">FOOL&apos;S GOLD</Link>
          <span className="ops-divider">/</span>
          <Link href="/admin">Admin</Link>
          <span className="ops-divider">/</span>
          <span>Security</span>
        </div>
        <nav>
          <Link href="/admin/users">Users</Link>
          <Link href="/admin/audit">Audit</Link>
        </nav>
      </header>

      <div className="ops-content">
        <section className="ops-hero">
          <div>
            <p className="ops-kicker">SECURITY</p>
            <h1>Notifications</h1>
            <p>
              Every time PTS are added or removed, every single win of 100 PTS or more, and every password change appears here
              with who did it, for whom, and the balance afterwards. Mark an item seen once you have checked it.
            </p>
          </div>
          <div className="ops-refresh">
            <button onClick={() => void load()} disabled={state === 'loading'}>Refresh</button>
          </div>
        </section>

        {error && <p className="ops-alert">{error}</p>}

        <div className="casino-filters">
          <label>
            <input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />
            {' '}Only items I have not marked seen ({data?.unread ?? 0})
          </label>
        </div>

        {state === 'loading' && <p className="state">Loading…</p>}

        {state === 'ready' && data && (
          <div className="ops-list">
            {data.items.length === 0 && (
              <div className="ops-list-item"><p>{unreadOnly ? 'Nothing new. You are up to date.' : 'No events yet.'}</p></div>
            )}
            {data.items.map((event) => (
              <div className="ops-list-item" key={event.id}>
                <div className="ops-list-top">
                  <strong>{TITLE[event.type]}</strong>
                  <span className={`ops-status ${event.severity === 'ALERT' ? 'bad' : event.severity === 'WARNING' ? 'warn' : 'neutral'}`}>
                    {event.severity === 'ALERT' ? 'Check now' : event.severity === 'WARNING' ? 'Review' : 'Info'}
                  </span>
                </div>
                <p>{sentence(event)}</p>
                {event.reason && <p>Reference: {event.reason}</p>}
                {event.type === 'PASSWORD_CHANGED' && <p>If this was not expected, reset their password from the Players page.</p>}
                <p>
                  <small>
                    {new Date(event.createdAt).toLocaleString()}
                    {event.balanceAfter !== null && <> · balance afterwards {formatPoints(event.balanceAfter)}</>}
                  </small>
                </p>
                {event.acknowledgedAt ? (
                  <p><small>Seen {new Date(event.acknowledgedAt).toLocaleString()}</small></p>
                ) : (
                  <div className="admin-game-actions">
                    <button className="casino-secondary" disabled={busy === event.id} onClick={() => void acknowledge(event.id)}>
                      Mark as seen
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
