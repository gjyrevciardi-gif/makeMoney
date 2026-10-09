'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ConfigList,
  ConfigVersion,
  GameConfig,
  RTP_CONTROL_LABEL,
  adminGet,
  adminSend,
  describeAdminError,
  formatPoints,
} from '../../../../lib/admin';
import { useSession } from '../../../../lib/queries';
import { hasCapability } from '../../../../lib/capabilities';

const SLOT_PROFILES = ['STANDARD', 'REDUCED', 'MINIMAL'];

/**
 * Casino game configuration.
 *
 * Everything on this page changes future configuration only. The controls
 * offered per game follow what the mathematics genuinely supports: a return
 * dial where the payout formula consumes it, approved profiles where the
 * return is a property of a frozen table, and limits only where the rules of
 * the game fix the return. The backend validates and decides regardless.
 */
export default function CasinoConfigPage() {
  const [config, setConfig] = useState<ConfigList | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'denied'>('loading');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, ConfigVersion[]>>({});
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const session = useSession();
  const platformManager = hasCapability(session.data?.role, 'PLATFORM_MANAGE');

  const load = useCallback(async () => {
    const list = await adminGet<ConfigList>('/admin/casino/config');
    if (!list) {
      setState('denied');
      return;
    }
    setConfig(list);
    setState('ready');
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, action: () => Promise<unknown>, message: string) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(message);
      await load();
    } catch (failure) {
      setError(describeAdminError(failure as { code: string; message: string }));
    } finally {
      setBusy('');
    }
  };

  const loadHistory = async (gameId: string) => {
    const response = await adminGet<{ versions: ConfigVersion[] }>(
      `/admin/casino/config/${gameId}/versions?limit=25`,
    );
    setHistory((current) => ({ ...current, [gameId]: response?.versions ?? [] }));
  };

  const toggleExpanded = async (gameId: string) => {
    if (expanded === gameId) {
      setExpanded(null);
      return;
    }
    setExpanded(gameId);
    if (!history[gameId]) await loadHistory(gameId);
  };

  const draftFor = (game: GameConfig) => {
    const existing = drafts[game.gameId];
    if (existing) return existing;
    return {
      minStake: game.activeVersion?.minStake ?? '1',
      maxStake: game.activeVersion?.maxStake ?? '1000000',
      rtpBps: String(game.activeVersion?.rtpBps ?? ''),
      profile: String(
        (game.activeVersion?.gameSpecific as { profile?: string } | undefined)?.profile ?? 'STANDARD',
      ),
      reason: '',
    };
  };

  const setDraft = (gameId: string, field: string, value: string) =>
    setDrafts((current) => ({
      ...current,
      [gameId]: { ...(current[gameId] ?? {}), [field]: value },
    }));

  /**
   * Creates a draft and activates it in one operator gesture.
   *
   * The slider or field only proposes numbers; the backend validates them,
   * decides the resulting mathematics, and records an immutable version.
   */
  const publish = async (game: GameConfig) => {
    const draft = draftFor(game);
    const current = game.activeVersion;
    const changingRtp = game.rtpControl === 'DIRECT'
      && current?.rtpBps !== undefined
      && Number(draft.rtpBps) !== current?.rtpBps;

    if (changingRtp) {
      const from = ((current?.rtpBps ?? 0) / 100).toFixed(2);
      const to = (Number(draft.rtpBps) / 100).toFixed(2);
      const confirmed = window.confirm(
        `Change ${game.name} return from ${from}% to ${to}%?\n\n`
        + 'This applies to NEW ROUNDS ONLY. Rounds already played or in progress '
        + 'keep the configuration they were opened under.',
      );
      if (!confirmed) return;
    }

    const body: Record<string, unknown> = {
      minStake: Number(draft.minStake),
      maxStake: Number(draft.maxStake),
      ...(draft.reason ? { reason: draft.reason } : {}),
    };
    if (game.rtpControl === 'DIRECT') body.rtpBps = Number(draft.rtpBps);
    if (game.rtpControl === 'CANONICAL') body.rtpBps = current?.rtpBps ?? null;
    if (game.gameId === 'fools-gold-rush') body.gameSpecific = { profile: draft.profile };
    if (game.gameId === 'plinko') body.gameSpecific = { profile: 'V1' };
    if (game.gameId === 'mines') {
      body.gameSpecific = current?.gameSpecific ?? { allowedMines: [1, 3, 5, 10, 15, 24] };
    }
    if (game.gameId === 'crash' || game.gameId === 'blackjack' || game.gameId === 'roulette') {
      body.gameSpecific = current?.gameSpecific ?? {};
    }

    await run(`publish:${game.gameId}`, async () => {
      const created = await adminSend<ConfigVersion>(
        `/admin/casino/config/${game.gameId}/versions`, 'POST', body,
      );
      await adminSend(
        `/admin/casino/config/${game.gameId}/versions/${created.versionId}/activate`,
        'POST',
        { expectedCurrentVersion: current?.version },
      );
      setDrafts((all) => {
        const next = { ...all };
        delete next[game.gameId];
        return next;
      });
      if (history[game.gameId]) await loadHistory(game.gameId);
    }, `${game.name} updated. Applies to new rounds only.`);
  };

  const setStatus = (game: GameConfig, patch: { enabled?: boolean; maintenance?: boolean }) => {
    if (patch.enabled === false) {
      const confirmed = window.confirm(
        `Disable ${game.name}?\n\nNew rounds will be refused. Rounds already in `
        + 'progress stay playable so no committed stake is trapped.',
      );
      if (!confirmed) return Promise.resolve();
    }
    return run(
      `status:${game.gameId}`,
      () => adminSend(`/admin/casino/config/${game.gameId}/status`, 'PATCH', patch),
      `${game.name} updated.`,
    );
  };

  const setPlatform = (patch: { casinoMaintenance?: boolean; sportsbookMaintenance?: boolean }) => {
    const turningOn = patch.casinoMaintenance === true || patch.sportsbookMaintenance === true;
    if (turningOn) {
      const what = patch.casinoMaintenance ? 'the whole casino' : 'the sportsbook';
      const confirmed = window.confirm(
        `Put ${what} into maintenance?\n\nNew rounds and bets will be refused. `
        + 'Settlement, payouts and refunds continue as normal.',
      );
      if (!confirmed) return Promise.resolve();
    }
    return run('platform', () => adminSend('/admin/platform/maintenance', 'PATCH', patch), 'Maintenance updated.');
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
          <span>Game configuration</span>
        </div>
        <nav>
          <Link href="/admin/users">Users</Link>
          {platformManager && <Link href="/admin/sports">Sports operations</Link>}
        </nav>
      </header>

      <div className="ops-content">
        <section className="ops-hero">
          <div>
            <p className="ops-kicker">FUTURE ROUNDS ONLY</p>
            <h1>Game configuration</h1>
            <p>
              Changes create a new immutable version and apply to new rounds only.
              Rounds already played or in progress keep the configuration they were
              opened under, and remain verifiable against it.
            </p>
          </div>
          <div className="ops-refresh">
            <button onClick={() => void load()} disabled={busy !== ''}>Refresh</button>
          </div>
        </section>

        {error && <p className="ops-alert">{error}</p>}
        {notice && <p className="ops-alert ops-alert-action">{notice}</p>}
        {state === 'loading' && <p className="state">Loading…</p>}

        {state === 'ready' && config && (
          <>
            {platformManager && (
              <section className="ops-section">
                <div className="ops-section-heading"><h2>Platform maintenance</h2></div>
                <div className="admin-platform">
                <label className="admin-switch">
                  <input
                    type="checkbox"
                    checked={config.platform.casinoMaintenance}
                    disabled={busy === 'platform'}
                    onChange={(event) =>
                      void setPlatform({ casinoMaintenance: event.target.checked })}
                  />
                  <span>Casino maintenance</span>
                  <small>Blocks new rounds. In-progress rounds stay resolvable.</small>
                </label>
                <label className="admin-switch">
                  <input
                    type="checkbox"
                    checked={config.platform.sportsbookMaintenance}
                    disabled={busy === 'platform'}
                    onChange={(event) =>
                      void setPlatform({ sportsbookMaintenance: event.target.checked })}
                  />
                  <span>Sportsbook maintenance</span>
                  <small>Blocks new bets. Settlement and payouts continue.</small>
                </label>
                </div>
              </section>
            )}

            <section className="ops-section">
              <div className="ops-section-heading">
                <h2>Games</h2>
                <span>{config.games.length} configured</span>
              </div>

              {config.games.map((game) => {
                const draft = draftFor(game);
                const active = game.activeVersion;
                const rtpPercent = active?.rtpBps === null || active?.rtpBps === undefined
                  ? null
                  : (active.rtpBps / 100).toFixed(2);
                return (
                  <article className="admin-game" key={game.gameId}>
                    <header className="admin-game-head">
                      <div>
                        <h3>{game.name}</h3>
                        <small>
                          {game.gameId} · {RTP_CONTROL_LABEL[game.rtpControl]}
                        </small>
                      </div>
                      <div className="admin-game-flags">
                        <span className={`ops-status ${game.enabled ? 'good' : 'bad'}`}>
                          {game.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                        {game.maintenance && <span className="ops-status warn">Maintenance</span>}
                      </div>
                    </header>

                    <dl className="admin-game-stats">
                      <div>
                        <dt>Active version</dt>
                        <dd>{active ? `v${active.version}` : '—'}</dd>
                      </div>
                      <div>
                        <dt>Config label</dt>
                        <dd><small>{active?.label ?? '—'}</small></dd>
                      </div>
                      <div>
                        <dt>Theoretical RTP</dt>
                        <dd>{rtpPercent ? `${rtpPercent}%` : 'rule based'}</dd>
                      </div>
                      <div>
                        <dt>House edge</dt>
                        <dd>
                          {active?.houseEdgeBps === null || active?.houseEdgeBps === undefined
                            ? '—'
                            : `${(active.houseEdgeBps / 100).toFixed(2)}%`}
                        </dd>
                      </div>
                      <div>
                        <dt>Stake limits</dt>
                        <dd>
                          {formatPoints(active?.minStake)} – {formatPoints(active?.maxStake)}
                        </dd>
                      </div>
                    </dl>

                    <div className="admin-game-controls">
                      <label className="casino-field">
                        <span>Minimum stake</span>
                        <input
                          inputMode="numeric"
                          value={draft.minStake}
                          onChange={(event) =>
                            setDraft(game.gameId, 'minStake', event.target.value.replace(/[^\d]/g, ''))}
                        />
                      </label>
                      <label className="casino-field">
                        <span>Maximum stake</span>
                        <input
                          inputMode="numeric"
                          value={draft.maxStake}
                          onChange={(event) =>
                            setDraft(game.gameId, 'maxStake', event.target.value.replace(/[^\d]/g, ''))}
                        />
                      </label>

                      {game.rtpControl === 'DIRECT' && (
                        <label className="casino-field admin-rtp">
                          <span>
                            RTP {(Number(draft.rtpBps || 0) / 100).toFixed(2)}% · house edge{' '}
                            {((10_000 - Number(draft.rtpBps || 0)) / 100).toFixed(2)}%
                          </span>
                          <input
                            type="range"
                            min={game.rtpBounds.minBps}
                            max={game.rtpBounds.maxBps}
                            step={1}
                            value={Number(draft.rtpBps || game.rtpBounds.maxBps)}
                            onChange={(event) => setDraft(game.gameId, 'rtpBps', event.target.value)}
                          />
                          <input
                            inputMode="numeric"
                            value={draft.rtpBps}
                            onChange={(event) =>
                              setDraft(game.gameId, 'rtpBps', event.target.value.replace(/[^\d]/g, ''))}
                          />
                          <small>
                            Allowed {(game.rtpBounds.minBps / 100).toFixed(2)}% –{' '}
                            {(game.rtpBounds.maxBps / 100).toFixed(2)}% in basis points.
                          </small>
                        </label>
                      )}

                      {game.gameId === 'fools-gold-rush' && (
                        <div className="casino-field">
                          <span>Approved profile</span>
                          <div className="casino-toggle">
                            {SLOT_PROFILES.map((profile) => (
                              <button
                                type="button"
                                key={profile}
                                className={draft.profile === profile ? 'active' : ''}
                                onClick={() => setDraft(game.gameId, 'profile', profile)}
                              >
                                {profile}
                              </button>
                            ))}
                          </div>
                          <small className="casino-meta">
                            Each profile is a frozen paytable whose exact return the server
                            recomputes before it can be activated. Reel stops are never touched.
                          </small>
                        </div>
                      )}

                      {game.rtpControl === 'CANONICAL' && (
                        <p className="casino-meta">
                          The single-zero wheel pays 36/37 by its own rules. Only limits and
                          availability are configurable.
                        </p>
                      )}
                      {game.rtpControl === 'RULE_BASED' && (
                        <p className="casino-meta">
                          Return follows the published rules and the player&apos;s decisions,
                          so there is no single figure to dial. Deck count, the soft-17 rule
                          and the natural payout are versioned in the active configuration.
                        </p>
                      )}

                      <label className="casino-field">
                        <span>Reason (optional)</span>
                        <input
                          value={draft.reason}
                          placeholder="Recorded in the audit trail"
                          onChange={(event) => setDraft(game.gameId, 'reason', event.target.value)}
                        />
                      </label>
                    </div>

                    <div className="admin-game-actions">
                      <button
                        className="ops-action"
                        disabled={busy !== ''}
                        onClick={() => void publish(game)}
                      >
                        {busy === `publish:${game.gameId}` ? 'Publishing…' : 'Publish new version'}
                      </button>
                      <button
                        className="casino-secondary"
                        disabled={busy !== ''}
                        onClick={() => void setStatus(game, { enabled: !game.enabled })}
                      >
                        {game.enabled ? 'Disable game' : 'Enable game'}
                      </button>
                      <button
                        className="casino-secondary"
                        disabled={busy !== ''}
                        onClick={() => void setStatus(game, { maintenance: !game.maintenance })}
                      >
                        {game.maintenance ? 'End maintenance' : 'Start maintenance'}
                      </button>
                      <button
                        className="casino-secondary"
                        onClick={() => void toggleExpanded(game.gameId)}
                      >
                        {expanded === game.gameId ? 'Hide history' : 'Version history'}
                      </button>
                    </div>

                    {expanded === game.gameId && (
                      <div className="ops-table-wrap">
                        <table className="ops-table">
                          <thead>
                            <tr>
                              <th>Version</th><th>Status</th><th>RTP</th><th>Stakes</th>
                              <th>Created by</th><th>Created</th><th>Activated</th><th>Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(history[game.gameId] ?? []).map((version) => (
                              <tr key={version.versionId}>
                                <td>v{version.version}<br /><small>{version.label}</small></td>
                                <td>
                                  <span className={`ops-status ${
                                    version.status === 'ACTIVE' ? 'good'
                                      : version.status === 'DRAFT' ? 'warn' : 'neutral'}`}
                                  >
                                    {version.status}
                                  </span>
                                </td>
                                <td>{version.rtpPercent ? `${version.rtpPercent}%` : '—'}</td>
                                <td>
                                  {formatPoints(version.minStake)}–{formatPoints(version.maxStake)}
                                </td>
                                <td><small>{version.createdBy?.email ?? '—'}</small></td>
                                <td><small>{new Date(version.createdAt).toLocaleString()}</small></td>
                                <td>
                                  <small>
                                    {version.activatedAt
                                      ? new Date(version.activatedAt).toLocaleString()
                                      : '—'}
                                  </small>
                                </td>
                                <td><small>{version.reason ?? '—'}</small></td>
                              </tr>
                            ))}
                            {(history[game.gameId] ?? []).length === 0 && (
                              <tr><td className="ops-empty" colSpan={8}>No versions yet.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
