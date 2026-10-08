'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';

type Overview = {
  openBets: number;
  staleOpenBets: number;
  settledLast24h: number;
  winsLast24h: number;
  lossesLast24h: number;
  voidsLast24h: number;
  settlementFailuresLast24h: number;
  resultConflicts: number;
  eventsAwaitingResult: number;
};

type SettlementWorker = {
  enabled: boolean;
  pollIntervalSeconds?: number;
  lastStartedAt?: string | null;
  lastCompletedAt?: string | null;
  lastStatus?: string | null;
  lastDurationMs?: number | null;
  eventsChecked?: number | null;
  failures?: number | null;
  consecutiveRunFailures?: number | null;
};

type ProviderStatus = {
  name: string;
  configured: boolean;
  healthy?: boolean | null;
  status?: string | null;
  healthStatus?: string | null;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  lastErrorCode?: string | null;
  remainingQuota?: number | null;
  quotaState?: string | null;
  cacheHealthy?: boolean | null;
  settlementWorker?: SettlementWorker | null;
};

type SettlementAttempt = {
  status?: string | null;
  errorCode?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt?: string | null;
};

type StaleEvent = {
  provider: string;
  providerEventId: string;
  sport?: string | null;
  sportKey?: string | null;
  event?: string | null;
  eventName?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
  eventStartTime?: string | null;
  startTime?: string | null;
  resultStatus?: string | null;
};

type StaleBet = {
  betId: string;
  userId: string;
  betType: string;
  stake: string | number;
  status: string;
  placedAt: string;
  diagnosticReason: string;
  events: StaleEvent[];
  lastAttempt?: SettlementAttempt | null;
};

type SettlementFailure = {
  id: string;
  provider: string;
  providerEventId: string;
  betId?: string | null;
  attemptType?: string | null;
  status?: string | null;
  errorCode?: string | null;
  errorMessageSafe?: string | null;
  retryCount?: number | null;
  createdAt: string;
  resolvedAt?: string | null;
};

type ResultSummary = {
  status?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  completedAt?: string | null;
};

type ResultConflict = {
  id: string;
  provider: string;
  providerEventId: string;
  storedResult?: ResultSummary | string | null;
  conflictingResult?: ResultSummary | string | null;
  conflictingResultSummary?: ResultSummary | string | null;
  detectedAt: string;
  affectedBets?: string[] | number | null;
  affectedLegs?: string[] | number | null;
  currentBetStates?: string[] | null;
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
};

type PageResult<T> = { items: T[]; nextCursor?: string | null };
type ProviderResponse = { providers: ProviderStatus[] };

const EMPTY_OVERVIEW: Overview = {
  openBets: 0,
  staleOpenBets: 0,
  settledLast24h: 0,
  winsLast24h: 0,
  lossesLast24h: 0,
  voidsLast24h: 0,
  settlementFailuresLast24h: 0,
  resultConflicts: 0,
  eventsAwaitingResult: 0,
};

function formatDate(value?: string | null) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function formatAge(value?: string | null) {
  if (!value) return 'Unknown';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 'Unknown';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatCode(value?: string | null) {
  return value ? value.replaceAll('_', ' ') : 'Unknown';
}

function eventLabel(event: StaleEvent) {
  if (event.eventName ?? event.event) return event.eventName ?? event.event;
  if (event.homeTeam && event.awayTeam) return `${event.homeTeam} vs ${event.awayTeam}`;
  return event.providerEventId;
}

function resultLabel(value?: ResultSummary | string | null) {
  if (!value) return 'Not available';
  if (typeof value === 'string') return value.slice(0, 120);
  const score = value.homeScore !== undefined && value.homeScore !== null &&
    value.awayScore !== undefined && value.awayScore !== null
    ? `${value.homeScore}–${value.awayScore}`
    : undefined;
  return [value.status, score].filter(Boolean).join(' · ') || 'Recorded result';
}

function affectedCount(value?: string[] | number | null) {
  if (Array.isArray(value)) return value.length;
  return value ?? 0;
}

function statusTone(value?: string | null) {
  const normalized = value?.toUpperCase();
  if (['HEALTHY', 'SUCCESS', 'ENABLED', 'CONFIGURED'].includes(normalized ?? '')) return 'good';
  if (['DEGRADED', 'LOW_QUOTA', 'UNKNOWN', 'SKIPPED_LOCKED', 'NO_RESULT', 'UNSUPPORTED'].includes(normalized ?? '')) return 'warn';
  if (['FAILED', 'EXHAUSTED', 'CONFLICT', 'RATE_LIMITED', 'UNHEALTHY'].includes(normalized ?? '')) return 'bad';
  return 'neutral';
}

function providerHealth(provider: ProviderStatus) {
  if (!provider.configured) return 'NOT_CONFIGURED';
  return provider.status ?? provider.healthStatus ??
    (provider.healthy === true ? 'HEALTHY' : provider.healthy === false ? 'UNHEALTHY' : 'UNKNOWN');
}

function StatusPill({ value, tone }: { value: string; tone?: string }) {
  return <span className={`ops-status ${tone ?? statusTone(value)}`}>{formatCode(value)}</span>;
}

function Id({ value }: { value: string }) {
  return <code className="ops-id" title={value}>{value}</code>;
}

async function readJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (!response.ok) throw new DashboardError(response.status);
  return response.json() as Promise<T>;
}

class DashboardError extends Error {
  constructor(readonly status: number) {
    super(`Dashboard request failed (${status})`);
  }
}

export default function SportsOperationsPage() {
  const [overview, setOverview] = useState<Overview>(EMPTY_OVERVIEW);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [staleBets, setStaleBets] = useState<StaleBet[]>([]);
  const [failures, setFailures] = useState<SettlementFailure[]>([]);
  const [conflicts, setConflicts] = useState<ResultConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [reconciling, setReconciling] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState('');

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setLoadError('');

    const results = await Promise.allSettled([
      readJson<Overview>('/admin/sports/overview'),
      readJson<ProviderResponse>('/admin/sports/providers/status'),
      readJson<PageResult<StaleBet>>('/admin/sports/bets/stale?limit=50'),
      readJson<PageResult<SettlementFailure>>('/admin/sports/settlement/failures?limit=50'),
      readJson<PageResult<ResultConflict>>('/admin/sports/conflicts?limit=50'),
    ]);

    const denied = results.some(result => result.status === 'rejected' &&
      result.reason instanceof DashboardError && result.reason.status === 403);
    if (denied) {
      setAccessDenied(true);
      setLoading(false);
      return;
    }

    setAccessDenied(false);
    if (results[0].status === 'fulfilled') setOverview(results[0].value);
    if (results[1].status === 'fulfilled') setProviders(results[1].value.providers ?? []);
    if (results[2].status === 'fulfilled') setStaleBets(results[2].value.items ?? []);
    if (results[3].status === 'fulfilled') setFailures(results[3].value.items ?? []);
    if (results[4].status === 'fulfilled') setConflicts(results[4].value.items ?? []);

    const failedCount = results.filter(result => result.status === 'rejected').length;
    if (failedCount) {
      const sessionExpired = results.some(result => result.status === 'rejected' &&
        result.reason instanceof DashboardError && result.reason.status === 401);
      setLoadError(sessionExpired
        ? 'Your session has expired. Sign in again to view sportsbook operations.'
        : `${failedCount} dashboard section${failedCount === 1 ? '' : 's'} could not be loaded.`);
    }
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  async function reconcile(provider: string, providerEventId: string) {
    const key = `${provider}:${providerEventId}`;
    setReconciling(key);
    setActionMessage('');

    try {
      const response = await apiFetch(
        `/admin/sports/events/${encodeURIComponent(provider)}/${encodeURIComponent(providerEventId)}/reconcile`,
        { method: 'POST' },
      );
      if (response.status === 403) {
        setAccessDenied(true);
        return;
      }
      if (!response.ok) {
        setActionMessage('Reconciliation could not be completed. The bet remains unchanged.');
        return;
      }

      setActionMessage(`Authoritative reconciliation requested for ${providerEventId}.`);
      await loadDashboard();
    } catch {
      setActionMessage('Reconciliation could not be completed. The bet remains unchanged.');
    } finally {
      setReconciling(null);
    }
  }

  if (accessDenied) {
    return <main className="ops-page ops-centered">
      <section className="ops-denied" role="alert">
        <p className="ops-kicker">ADMIN ACCESS REQUIRED</p>
        <h1>Sportsbook operations are restricted.</h1>
        <p>Your account does not have permission to view provider diagnostics or request reconciliation.</p>
        <a className="ops-link" href="/sports">Return to Sportsbook</a>
      </section>
    </main>;
  }

  const worker = providers.find(provider => provider.settlementWorker)?.settlementWorker;
  const configuredProviders = providers.filter(provider => provider.configured);
  const healthyProviders = configuredProviders.filter(provider => providerHealth(provider) === 'HEALTHY');
  const providerSummary = !providers.length
    ? 'Unknown'
    : configuredProviders.length === 0
      ? 'Not configured'
      : `${healthyProviders.length}/${configuredProviders.length} healthy`;

  return <main className="ops-page">
    <header className="ops-header">
      <div>
        <a className="brand" href="/">FOOL&apos;S GOLD</a>
        <span className="ops-divider">/</span>
        <span>Sports Operations</span>
      </div>
      <nav>
        <a href="/sports">Sportsbook</a>
        <a href="/my-bets">My Bets</a>
      </nav>
    </header>

    <div className="ops-content">
      <section className="ops-hero">
        <div>
          <p className="ops-kicker">ADMIN · AUTHORITATIVE RESULTS ONLY</p>
          <h1>Settlement control room</h1>
          <p>Monitor open bets, provider health, failures, and conflicts. Reconciliation retries the provider-backed settlement path and never chooses an outcome.</p>
        </div>
        <div className="ops-refresh">
          <button onClick={() => void loadDashboard()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh data'}</button>
          <small>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Waiting for current data'}</small>
        </div>
      </section>

      {loadError && <div className="ops-alert" role="alert">{loadError}</div>}
      {actionMessage && <div className="ops-alert ops-alert-action" role="status">{actionMessage}</div>}

      <section className="ops-section" aria-labelledby="overview-title">
        <div className="ops-section-heading">
          <div><p className="ops-kicker">OVERVIEW</p><h2 id="overview-title">Live operational state</h2></div>
        </div>
        <div className="ops-card-grid">
          <article className="ops-card"><span>Open Bets</span><strong>{overview.openBets}</strong><small>{overview.eventsAwaitingResult} events awaiting result</small></article>
          <article className="ops-card ops-card-warn"><span>Stale Bets</span><strong>{overview.staleOpenBets}</strong><small>Alerts only · no status mutation</small></article>
          <article className="ops-card ops-card-bad"><span>Failures · 24h</span><strong>{overview.settlementFailuresLast24h}</strong><small>Material settlement attempts</small></article>
          <article className="ops-card ops-card-bad"><span>Result Conflicts</span><strong>{overview.resultConflicts}</strong><small>Require investigation</small></article>
          <article className="ops-card"><span>Provider Status</span><strong className="ops-card-text">{providerSummary}</strong><small>Configured result providers</small></article>
          <article className="ops-card"><span>Settlement Worker</span><strong className="ops-card-text">{worker?.enabled ? formatCode(worker.lastStatus ?? 'Enabled') : 'Disabled'}</strong><small>{worker?.lastCompletedAt ? `Last completed ${formatDate(worker.lastCompletedAt)}` : 'No completed run recorded'}</small></article>
        </div>
        <div className="ops-metrics" aria-label="Last 24 hour settlement metrics">
          <span><strong>{overview.settledLast24h}</strong> settled</span>
          <span><strong>{overview.winsLast24h}</strong> won</span>
          <span><strong>{overview.lossesLast24h}</strong> lost</span>
          <span><strong>{overview.voidsLast24h}</strong> void</span>
        </div>
      </section>

      <section className="ops-section" aria-labelledby="providers-title">
        <div className="ops-section-heading">
          <div><p className="ops-kicker">PROVIDER HEALTH</p><h2 id="providers-title">Results, quota, cache, and worker</h2></div>
          <span>{providers.length} provider{providers.length === 1 ? '' : 's'}</span>
        </div>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead><tr><th>Provider</th><th>Configured</th><th>Status</th><th>Last Success</th><th>Last Failure</th><th>Quota</th><th>Cache</th><th>Worker</th></tr></thead>
            <tbody>
              {providers.map(provider => <tr key={provider.name}>
                <td><strong>{provider.name}</strong>{provider.lastErrorCode && <small>{formatCode(provider.lastErrorCode)}</small>}</td>
                <td><StatusPill value={provider.configured ? 'Configured' : 'Not configured'} tone={provider.configured ? 'good' : 'neutral'} /></td>
                <td><StatusPill value={providerHealth(provider)} /></td>
                <td>{formatDate(provider.lastSuccessAt)}</td>
                <td>{formatDate(provider.lastFailureAt)}</td>
                <td><StatusPill value={provider.quotaState ?? 'Unknown'} />{provider.remainingQuota !== undefined && provider.remainingQuota !== null && <small>{provider.remainingQuota.toLocaleString()} remaining</small>}</td>
                <td><StatusPill value={provider.cacheHealthy === true ? 'Healthy' : provider.cacheHealthy === false ? 'Unhealthy' : 'Unknown'} /></td>
                <td>{provider.settlementWorker
                  ? <><StatusPill value={provider.settlementWorker.enabled ? provider.settlementWorker.lastStatus ?? 'Enabled' : 'Disabled'} /><small>{provider.settlementWorker.lastDurationMs !== undefined && provider.settlementWorker.lastDurationMs !== null ? `${provider.settlementWorker.lastDurationMs}ms · ` : ''}{provider.settlementWorker.eventsChecked ?? 0} events checked</small></>
                  : 'Not reported'}</td>
              </tr>)}
              {!providers.length && <tr><td colSpan={8} className="ops-empty">{loading ? 'Loading provider health…' : 'No provider health is currently available.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="ops-section" aria-labelledby="stale-title">
        <div className="ops-section-heading">
          <div><p className="ops-kicker">STALE BETS</p><h2 id="stale-title">Open bets needing attention</h2></div>
          <span>{staleBets.length} shown</span>
        </div>
        <div className="ops-table-wrap">
          <table className="ops-table ops-stale-table">
            <thead><tr><th>Bet ID</th><th>User</th><th>Type</th><th>Stake</th><th>Event</th><th>Start / Age</th><th>Diagnostic</th><th>Last Attempt</th><th>Action</th></tr></thead>
            <tbody>
              {staleBets.map(bet => <tr key={bet.betId}>
                <td><Id value={bet.betId} /></td>
                <td><Id value={bet.userId} /></td>
                <td>{formatCode(bet.betType)}</td>
                <td><strong>{bet.stake}</strong> pts</td>
                <td>{bet.events.map(event => <div className="ops-event" key={`${event.provider}:${event.providerEventId}`}><strong>{eventLabel(event)}</strong><small>{event.provider} · {event.resultStatus ? formatCode(event.resultStatus) : 'No final result'}</small></div>)}</td>
                <td>{bet.events.map(event => { const start = event.eventStartTime ?? event.startTime; return <div className="ops-event" key={`${event.providerEventId}:time`}><span>{formatDate(start)}</span><small>{formatAge(start)} ago</small></div>; })}</td>
                <td><StatusPill value={bet.diagnosticReason} /></td>
                <td>{bet.lastAttempt ? <><StatusPill value={bet.lastAttempt.status ?? 'Unknown'} /><small>{bet.lastAttempt.errorCode ? `${formatCode(bet.lastAttempt.errorCode)} · ` : ''}{formatDate(bet.lastAttempt.finishedAt ?? bet.lastAttempt.startedAt ?? bet.lastAttempt.createdAt)}</small></> : 'No attempt recorded'}</td>
                <td>{bet.events.map(event => { const key = `${event.provider}:${event.providerEventId}`; return <button className="ops-action" key={`${key}:action`} disabled={reconciling !== null} onClick={() => void reconcile(event.provider, event.providerEventId)}>{reconciling === key ? 'Reconciling…' : 'Reconcile event'}</button>; })}</td>
              </tr>)}
              {!staleBets.length && <tr><td colSpan={9} className="ops-empty">{loading ? 'Checking open bets…' : 'No stale open bets detected.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="ops-two-column">
        <section className="ops-section" aria-labelledby="failures-title">
          <div className="ops-section-heading"><div><p className="ops-kicker">SETTLEMENT FAILURES</p><h2 id="failures-title">Recent material failures</h2></div><span>{failures.length} shown</span></div>
          <div className="ops-list">
            {failures.map(failure => <article className="ops-list-item" key={failure.id}>
              <div className="ops-list-top"><StatusPill value={failure.errorCode ?? failure.status ?? 'Failed'} /><time>{formatDate(failure.createdAt)}</time></div>
              <h3>{failure.provider} · <Id value={failure.providerEventId} /></h3>
              <p>{failure.errorMessageSafe ?? 'The provider-backed settlement attempt did not complete.'}</p>
              <div className="ops-list-meta"><span>{formatCode(failure.attemptType)}</span><span>Retries: {failure.retryCount ?? 0}</span><span>{failure.resolvedAt ? `Resolved ${formatDate(failure.resolvedAt)}` : 'Unresolved'}</span></div>
            </article>)}
            {!failures.length && <p className="ops-empty">{loading ? 'Loading settlement attempts…' : 'No recent settlement failures.'}</p>}
          </div>
        </section>

        <section className="ops-section" aria-labelledby="conflicts-title">
          <div className="ops-section-heading"><div><p className="ops-kicker">RESULT CONFLICTS</p><h2 id="conflicts-title">Authoritative result mismatches</h2></div><span>{conflicts.length} shown</span></div>
          <div className="ops-list">
            {conflicts.map(conflict => <article className="ops-list-item ops-conflict" key={conflict.id}>
              <div className="ops-list-top"><StatusPill value={conflict.acknowledgedAt ? 'Acknowledged' : 'Conflict'} /><time>{formatDate(conflict.detectedAt)}</time></div>
              <h3>{conflict.provider} · <Id value={conflict.providerEventId} /></h3>
              <dl className="ops-result-compare">
                <div><dt>Stored result</dt><dd>{resultLabel(conflict.storedResult)}</dd></div>
                <div><dt>Conflicting result</dt><dd>{resultLabel(conflict.conflictingResultSummary ?? conflict.conflictingResult)}</dd></div>
              </dl>
              <div className="ops-list-meta"><span>{affectedCount(conflict.affectedBets)} affected bets</span><span>{affectedCount(conflict.affectedLegs)} affected legs</span>{conflict.currentBetStates?.length ? <span>{conflict.currentBetStates.map(formatCode).join(', ')}</span> : null}</div>
              <p className="ops-safe-note">No automatic payout reversal is performed.</p>
            </article>)}
            {!conflicts.length && <p className="ops-empty">{loading ? 'Loading result conflicts…' : 'No result conflicts detected.'}</p>}
          </div>
        </section>
      </div>
    </div>
  </main>;
}
