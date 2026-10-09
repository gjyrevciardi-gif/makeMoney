'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { adminGet } from '../../../lib/admin';

type AuditEntry = {
  id: string;
  actorId: string | null;
  targetType: string | null;
  targetId: string | null;
  action: string;
  result: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

const TONE: Record<string, string> = {
  PERMISSION_DENIED: 'bad',
  CASINO_GAME_DISABLED: 'warn',
  CASINO_MAINTENANCE_CHANGED: 'warn',
  PLATFORM_MAINTENANCE_CHANGED: 'warn',
  CASINO_CONFIG_ACTIVATED: 'good',
  CASINO_CONFIG_CREATED: 'neutral',
};

/** Read-only audit trail. Entries are written by the backend and never edited. */
export default function AdminAuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'denied'>('loading');

  const load = useCallback(async () => {
    const list = await adminGet<AuditEntry[]>('/admin/audit?limit=100');
    if (!list) {
      setState('denied');
      return;
    }
    setEntries(list);
    setState('ready');
  }, []);

  useEffect(() => { void load(); }, [load]);

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
          <span>Audit</span>
        </div>
        <nav>
          <Link href="/admin/casino/config">Game configuration</Link>
          <Link href="/admin/users">Users</Link>
        </nav>
      </header>

      <div className="ops-content">
        <section className="ops-hero">
          <div>
            <p className="ops-kicker">IMMUTABLE TRAIL</p>
            <h1>Audit</h1>
            <p>Every configuration change, grant and denied attempt, newest first.</p>
          </div>
          <div className="ops-refresh">
            <button onClick={() => void load()}>Refresh</button>
          </div>
        </section>

        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr><th>When</th><th>Action</th><th>Result</th><th>Target</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {state === 'loading' && (
                <tr><td className="ops-empty" colSpan={5}>Loading…</td></tr>
              )}
              {state === 'ready' && entries.length === 0 && (
                <tr><td className="ops-empty" colSpan={5}>No audit entries yet.</td></tr>
              )}
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td><small>{new Date(entry.createdAt).toLocaleString()}</small></td>
                  <td>
                    <span className={`ops-status ${TONE[entry.action] ?? 'neutral'}`}>
                      {entry.action.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td><small>{entry.result}</small></td>
                  <td>
                    <small>{entry.targetType ?? '—'}</small>
                    <span className="ops-id">{entry.targetId ?? ''}</span>
                  </td>
                  <td>
                    <small className="admin-audit-meta">
                      {entry.metadata ? JSON.stringify(entry.metadata) : '—'}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
