'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { describeAdminError, newIdempotencyKey } from '../../../../lib/admin';
import {
  PAYOUT_MAX_WIN,
  PAYOUT_STYLES,
  activatePayout,
  generatePayoutCandidate,
  payoutCandidates,
  payoutCurrent,
  payoutHistory,
  payoutPreview,
  percent,
  points,
  ratio,
  restoreDefaultPayout,
  rollbackPayout,
  type PayoutActiveState,
  type PayoutCandidateView,
  type PayoutCurrent,
  type PayoutHistoryEntry,
  type PayoutReportMetrics,
  type PayoutStyle,
} from '../../../../lib/math-control';
import { AdminAccessGate } from '../../../../components/admin/admin-access-gate';

type Draft = {
  targetRtp: string;
  maxWin: string;
  style: PayoutStyle;
  requirePositiveLoss: boolean;
  requirePositivePartial: boolean;
  requirePositiveProfit: boolean;
  minFeatureWeightFraction: string;
};

type Report = {
  candidate: PayoutCandidateView;
  metrics: PayoutReportMetrics;
  artifactPath: string;
};

const initialDraft: Draft = {
  targetRtp: '70',
  maxWin: '50',
  style: 'RETENTION',
  requirePositiveLoss: true,
  requirePositivePartial: true,
  requirePositiveProfit: true,
  minFeatureWeightFraction: '',
};

const CENSOR_NOTE =
  'Every figure below comes from the server evidence run. Session-length, crash, and streak statistics are ' +
  'conditional on the predeclared sample and horizon; the RTP interval is a normal approximation over ' +
  'bankroll-dependent paid rounds, and any session that reached the horizon without busting is censored.';

/**
 * Lucky Lady RTP Control.
 *
 * Generate asks the accepted game-specific generator for a bounded payout
 * policy and its real server evidence. Nothing becomes live at generation.
 * Activation is only offered for a stored VALIDATED candidate and applies to
 * NEW paid rounds; a round already in flight keeps the mathematics it was
 * opened under. The page never shows an optimistic ACTIVE state and never lets
 * a browser value stand in for authoritative weights, a report, or evidence.
 */
export default function LuckyLadyRtpControlPage() {
  const [current, setCurrent] = useState<PayoutCurrent | null>(null);
  const [candidates, setCandidates] = useState<PayoutCandidateView[]>([]);
  const [history, setHistory] = useState<PayoutHistoryEntry[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'denied'>('loading');
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [unsolved, setUnsolved] = useState<{
    status: string;
    message: string;
    reasons: PayoutCandidateView['reasons'];
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmingDefault, setConfirmingDefault] = useState(false);

  const load = useCallback(async () => {
    try {
      const [snapshot, candidateList, historyList] = await Promise.all([
        payoutCurrent(),
        payoutCandidates(),
        payoutHistory(),
      ]);
      if (!snapshot) {
        // A non-OK response: either not an administrator or not signed in.
        setState('denied');
        return;
      }
      setCurrent(snapshot);
      setCandidates(candidateList?.candidates ?? []);
      setHistory(historyList?.entries ?? []);
      setState('ready');
    } catch {
      // A network or transport failure must never leave the page on "loading".
      setState('ready');
      setError('Could not reach the admin API. Check that the backend is running and you are signed in.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (failure) {
      setError(describeAdminError(failure as { code: string; message: string }));
    } finally {
      setBusy('');
    }
  };

  const generate = () =>
    run('generate', async () => {
      setReport(null);
      setUnsolved(null);
      const constraints: Record<string, unknown> = {};
      if (draft.style === 'CUSTOM') {
        constraints.requirePositiveLoss = draft.requirePositiveLoss;
        constraints.requirePositivePartial = draft.requirePositivePartial;
        constraints.requirePositiveProfit = draft.requirePositiveProfit;
        if (draft.minFeatureWeightFraction.trim() !== '') {
          constraints.minFeatureWeightFraction = draft.minFeatureWeightFraction.trim();
        }
      }
      const outcome = await generatePayoutCandidate({
        targetRtpPercent: Number(draft.targetRtp),
        maxWinMultiplier: Number(draft.maxWin) as 20 | 50,
        style: draft.style,
        ...(Object.keys(constraints).length > 0 ? { constraints } : {}),
      });
      await load();
      if (outcome.status === 'VALIDATED') {
        setReport({ candidate: outcome.candidate, metrics: outcome.metrics, artifactPath: '' });
        setNotice('Candidate generated and VALIDATED by the server. Review the evidence, then activate.');
        return;
      }
      setUnsolved({ status: outcome.status, message: outcome.message, reasons: outcome.reasons });
    });

  const preview = (candidateId: string, confirmActivation = false) =>
    run('preview', async () => {
      const found = await payoutPreview(candidateId);
      if (!found || !found.metrics) {
        setError('That candidate has no stored evidence report.');
        return;
      }
      setReport({ candidate: found.candidate, metrics: found.metrics, artifactPath: found.artifactPath });
      setConfirming(confirmActivation && found.candidate.status === 'VALIDATED');
      setUnsolved(null);
      setNotice(confirmActivation && found.candidate.status !== 'VALIDATED'
        ? 'Generate and validate a policy before enabling custom RTP control.'
        : `Loaded the stored evidence report for ${candidateId}.`);
    });

  const activate = (candidateId: string) =>
    run('activate', async () => {
      if (!current) return;
      const result = await activatePayout(candidateId, newIdempotencyKey(), current.active.version);
      setCurrent((previous) => previous ? { ...previous, active: result.active } : previous);
      setNotice(
        result.replay
          ? 'That activation was already recorded; showing the recorded state.'
          : `Activated ${candidateId} for NEW paid rounds only (revision ${result.version}).`,
      );
      setConfirming(false);
      await load();
    });

  const rollback = () =>
    run('rollback', async () => {
      if (!current) return;
      const result = await rollbackPayout(newIdempotencyKey(), current.active.version);
      setNotice(
        result.active.mode === 'DEFAULT'
          ? 'Rolled back to the golden default mathematics for NEW paid rounds.'
          : `Rolled back to the previous policy (revision ${result.version}) for NEW paid rounds.`,
      );
      await load();
    });

  const restoreDefault = () =>
    run('default', async () => {
      if (!current) return;
      const result = await restoreDefaultPayout(newIdempotencyKey(), current.active.version);
      setCurrent((previous) => previous ? { ...previous, active: result.active } : previous);
      setConfirmingDefault(false);
      setNotice(`Restored the golden RTP50 default for NEW paid rounds (revision ${result.version}).`);
      await load();
    });

  const toggleControl = () => {
    if (!current || busy !== '') return;
    if (current.active.mode === 'CUSTOM') {
      setConfirming(false);
      setConfirmingDefault(true);
      return;
    }
    const candidate = report?.candidate.status === 'VALIDATED'
      ? report.candidate
      : candidates.find((entry) => entry.status === 'VALIDATED');
    if (!candidate) {
      setNotice('Generate and validate a policy before enabling custom RTP control.');
      return;
    }
    // Re-read server evidence, then use the existing ACTIVATE confirmation.
    // Clicking ON never changes the authoritative mode by itself.
    void preview(candidate.candidateId, true);
  };

  const rejected = useMemo(() => candidates.filter((entry) => entry.status !== 'VALIDATED'), [candidates]);

  if (state === 'denied') return <AdminAccessGate area="Lucky Lady RTP Control" />;

  return (
    <main className="ops-page">
      <header className="ops-header">
        <div>
          <Link className="brand" href="/">FOOL&apos;S GOLD</Link>
          <span className="ops-divider">/</span>
          <Link href="/admin">Admin</Link>
          <span className="ops-divider">/</span>
          <span>Lucky Lady RTP Control</span>
        </div>
        <nav>
          <Link href="/admin/casino/config">Game configuration</Link>
          <Link href="/admin/users">Users</Link>
          <Link href="/admin/audit">Audit</Link>
        </nav>
      </header>

      <div className="ops-content">
        <section className="ops-hero">
          <div>
            <p className="ops-kicker">GENERATE · VALIDATE · ACTIVATE · NEW ROUNDS ONLY</p>
            <h1>Lucky Lady RTP Control</h1>
            <p>
              The backend is authoritative. It solves a bounded payout policy, produces the evidence report
              itself, and refuses activation without a stored VALIDATED candidate whose frozen hashes still
              match. No browser value chooses an outcome, a weight, or a result.
            </p>
          </div>
          <div className="ops-refresh">
            <button onClick={() => void load()} disabled={busy !== ''}>Refresh</button>
          </div>
        </section>

        {error && <p className="ops-alert">{error}</p>}
        {notice && <p className="ops-alert ops-alert-action">{notice}</p>}
        {state === 'loading' && <p className="state">Loading…</p>}

        {state === 'ready' && current && (
          <>
            <CurrentState
              active={current.active}
              defaultProfile={current.defaultProfile}
              busy={busy}
              onRollback={() => void rollback()}
              onDefault={() => setConfirmingDefault(true)}
              onToggle={toggleControl}
            />

            {confirmingDefault && (
              <section className="admin-control-note" role="dialog" aria-modal="false" aria-labelledby="default-confirm-title">
                <h2 id="default-confirm-title">Turn custom RTP control OFF?</h2>
                <p>Current: {current.active.mode === 'CUSTOM'
                  ? `Custom RTP ${percent(current.active.targetRtpPercent)} / MaxWin ${current.active.maxWinMultiplier ?? '—'}x / ${current.active.style ?? '—'}`
                  : `Default ${current.defaultProfile.profileId}`}</p>
                <p>New: Default {current.defaultProfile.profileId}</p>
                <p>Future new paid rounds will use the accepted default policy.
                  {' '}Existing rounds and feature chains remain locked to their originating policy.</p>
                <div className="ops-refresh" style={{ display: 'flex', gap: 8 }}>
                  <button disabled={busy !== ''} onClick={() => setConfirmingDefault(false)}>CANCEL</button>
                  <button className="ops-action" disabled={busy !== ''} onClick={() => void restoreDefault()}>CONFIRM OFF</button>
                </div>
              </section>
            )}

            <section className="ops-section">
              <div className="ops-section-heading">
                <h2>Generate candidate</h2>
                <span>server-generated · never live on generate</span>
              </div>
              <div className="admin-platform">
                <label className="casino-field">
                  <span>Target RTP 0..100</span>
                  <input
                    inputMode="decimal"
                    value={draft.targetRtp}
                    onChange={(event) => setDraft({ ...draft, targetRtp: event.target.value })}
                  />
                </label>
                <label className="casino-field">
                  <span>Max win (actual support)</span>
                  <select value={draft.maxWin} onChange={(event) => setDraft({ ...draft, maxWin: event.target.value })}>
                    {PAYOUT_MAX_WIN.map((value) => <option key={value} value={value}>{value}x</option>)}
                  </select>
                </label>
                <label className="casino-field">
                  <span>Style</span>
                  <select value={draft.style} onChange={(event) => setDraft({ ...draft, style: event.target.value as PayoutStyle })}>
                    {PAYOUT_STYLES.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                {draft.style === 'CUSTOM' && (
                  <>
                    <label className="admin-switch">
                      <input
                        type="checkbox"
                        checked={draft.requirePositiveLoss}
                        onChange={(event) => setDraft({ ...draft, requirePositiveLoss: event.target.checked })}
                      />
                      <span>Require positive loss</span>
                    </label>
                    <label className="admin-switch">
                      <input
                        type="checkbox"
                        checked={draft.requirePositivePartial}
                        onChange={(event) => setDraft({ ...draft, requirePositivePartial: event.target.checked })}
                      />
                      <span>Require positive partial</span>
                    </label>
                    <label className="admin-switch">
                      <input
                        type="checkbox"
                        checked={draft.requirePositiveProfit}
                        onChange={(event) => setDraft({ ...draft, requirePositiveProfit: event.target.checked })}
                      />
                      <span>Require positive profit</span>
                    </label>
                    <label className="casino-field">
                      <span>Min feature weight fraction (0..1)</span>
                      <input
                        inputMode="decimal"
                        value={draft.minFeatureWeightFraction}
                        placeholder="blank = model default"
                        onChange={(event) => setDraft({ ...draft, minFeatureWeightFraction: event.target.value })}
                      />
                    </label>
                  </>
                )}
                <div className="ops-refresh">
                  <button className="ops-action" onClick={() => void generate()} disabled={busy !== ''}>
                    {busy === 'generate' ? 'Generating…' : 'GENERATE'}
                  </button>
                </div>
              </div>
              <p className="ops-safe-note">
                The declared bounded generator supports {PAYOUT_MAX_WIN.join('x or ')}x only. Any other max-win
                request is refused with an explicit reason rather than approximated.
              </p>
              {busy === 'generate' && <p className="state">GENERATING · bounded solver + evidence run…</p>}
            </section>

            {unsolved && (
              <section className="ops-section">
                <div className="ops-section-heading">
                  <h2>Generation result</h2>
                  <span className="ops-status warn">{unsolved.status}</span>
                </div>
                <div className="admin-control-note">
                  <strong>{unsolved.status}</strong>
                  <p>{unsolved.message}</p>
                  {unsolved.reasons.length > 0 && (
                    <ul>
                      {unsolved.reasons.map((reason) => (
                        <li key={`${reason.constraint}:${reason.requested}`}>
                          <strong>{reason.constraint}</strong>: requested {reason.requested}; achievable {reason.achievable}. {reason.detail}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            )}

            {report && (
              <ReportSection
                report={report}
                activeVersion={current.active.version}
                current={current.active}
                alreadyActive={isActiveCandidate(current.active, report.candidate)}
                busy={busy}
                confirming={confirming}
                onConfirmToggle={() => setConfirming((value) => !value)}
                onActivate={() => void activate(report.candidate.candidateId)}
              />
            )}

            <section className="ops-section">
              <div className="ops-section-heading">
                <h2>Candidates</h2>
                <span>{candidates.length} stored · {rejected.length} not validated</span>
              </div>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Candidate</th><th>Status</th><th>Target</th><th>Style</th>
                      <th>Max x</th><th>Policy hash</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.length === 0 && (
                      <tr><td className="ops-empty" colSpan={7}>No payout candidates yet.</td></tr>
                    )}
                    {candidates.map((entry) => (
                      <tr key={entry.candidateId}>
                        <td><small>{entry.candidateId}</small></td>
                        <td>
                          <span className={`ops-status ${entry.status === 'VALIDATED' ? 'good' : 'warn'}`}>
                            {entry.status}
                          </span>
                          {entry.activated && <span className="ops-status good">ACTIVE</span>}
                        </td>
                        <td>{percent(entry.targetRtpPercent)}</td>
                        <td>{entry.style}</td>
                        <td>{entry.maxWinMultiplier}x</td>
                        <td><small>{entry.policyHash?.slice(0, 16) ?? '—'}</small></td>
                        <td>
                          <button onClick={() => void preview(entry.candidateId)} disabled={busy !== ''}>
                            Preview
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="ops-section">
              <div className="ops-section-heading">
                <h2>Activation history</h2>
                <span>append-only · time · policy · RTP · max · style · action · admin</span>
              </div>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>When</th><th>Action</th><th>Revision</th><th>Policy</th>
                      <th>Target</th><th>Max x</th><th>Style</th><th>Previous</th><th>Admin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.length === 0 && (
                      <tr><td className="ops-empty" colSpan={9}>No activation history yet.</td></tr>
                    )}
                    {history.map((entry) => (
                      <tr key={entry.id}>
                        <td><small>{new Date(entry.createdAt).toLocaleString()}</small></td>
                        <td><span className="ops-status neutral">{entry.action}</span></td>
                        <td>{entry.version}</td>
                        <td><small>{entry.profileId ?? 'golden default'}</small></td>
                        <td>{entry.targetRtpPercent === null ? '—' : percent(entry.targetRtpPercent)}</td>
                        <td>{entry.maxWinMultiplier === null ? '—' : `${entry.maxWinMultiplier}x`}</td>
                        <td>{entry.style ?? '—'}</td>
                        <td>
                          <small>
                            {entry.previous.mode === 'DEFAULT'
                              ? 'golden default'
                              : `v${entry.previous.version} · ${entry.previous.candidateId ?? entry.previous.policyId ?? 'policy'}`}
                          </small>
                        </td>
                        <td><small className="ops-id">{entry.actorId}</small></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function isActiveCandidate(active: PayoutActiveState, candidate: PayoutCandidateView) {
  return active.mode === 'CUSTOM' && active.modelHash === candidate.modelHash && active.policyHash === candidate.policyHash;
}

function CurrentState({
  active,
  defaultProfile,
  busy,
  onRollback,
  onDefault,
  onToggle,
}: {
  active: PayoutActiveState;
  defaultProfile: PayoutCurrent['defaultProfile'];
  busy: string;
  onRollback: () => void;
  onDefault: () => void;
  onToggle: () => void;
}) {
  const custom = active.mode === 'CUSTOM';
  return (
    <section className="ops-section">
      <div className="ops-section-heading">
        <h2 id="rtp-control-label">RTP CONTROL</h2>
        <button type="button" role="switch" aria-labelledby="rtp-control-label"
          aria-describedby="rtp-control-status" aria-checked={custom}
          disabled={busy !== ''} onClick={onToggle}>
          {custom ? 'ON' : 'OFF'}
        </button>
      </div>
      <p id="rtp-control-status">{custom
        ? `ON — Custom RTP${percent(active.targetRtpPercent, 2)} / MaxWin${active.maxWinMultiplier ?? '—'}x / ${active.style ?? '—'}`
        : 'OFF — Default RTP50'}</p>
      <div className="ops-section-heading">
        <h2>Current authoritative state</h2>
        <span>revision {active.version}</span>
      </div>
      <div className="ops-card-grid">
        <div className={`ops-card ${custom ? '' : 'ops-card-warn'}`}>
          <span>Mode</span>
          <strong className="ops-card-text">{custom ? (active.legacy ? 'CUSTOM (legacy)' : 'CUSTOM') : 'DEFAULT'}</strong>
          <small>
            {custom
              ? active.legacy
                ? 'activated outside the payout panel'
                : 'generated payout policy active'
              : 'immutable golden RTP50'}
          </small>
        </div>
        {custom ? (
          <>
            <div className="ops-card">
              <span>Profile</span>
              <strong className="ops-card-text">{active.profileId}</strong>
              <small>{active.modelHash?.slice(0, 20)}</small>
            </div>
            <div className="ops-card">
              <span>Target RTP</span>
              <strong>{percent(active.targetRtpPercent)}</strong>
              <small>policy target, not the model's raw EV</small>
            </div>
            <div className="ops-card">
              <span>Max win</span>
              <strong>{active.maxWinMultiplier ?? '—'}x</strong>
              <small>actual bounded support</small>
            </div>
            <div className="ops-card">
              <span>Style</span>
              <strong className="ops-card-text">{active.style ?? '—'}</strong>
              <small>generator objective</small>
            </div>
          </>
        ) : (
          <>
            <div className="ops-card">
              <span>Profile</span>
              <strong className="ops-card-text">{defaultProfile.profileId}</strong>
              <small>{defaultProfile.profileHash.slice(0, 24)}</small>
            </div>
            <div className="ops-card">
              <span>Target RTP</span>
              <strong>{percent(defaultProfile.rtpPercent)}</strong>
              <small>immutable golden hash</small>
            </div>
            <div className="ops-card">
              <span>Max win</span>
              <strong>{defaultProfile.maxWinMultiplier === null ? 'default (uncapped)' : `${defaultProfile.maxWinMultiplier}x`}</strong>
              <small>scope {defaultProfile.maxWinScope}</small>
            </div>
          </>
        )}
      </div>
      <p className="ops-safe-note">{active.note}</p>
      {!custom && <p className="ops-safe-note">{defaultProfile.note}</p>}
      <div className="ops-refresh" style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <button onClick={onRollback} disabled={busy !== ''}>
          {busy === 'rollback' ? 'Rolling back…' : 'ROLLBACK previous'}
        </button>
        <button className="ops-action" onClick={onDefault} disabled={busy !== ''}>
          {busy === 'default' ? 'Restoring…' : 'DEFAULT / OFF (golden RTP50)'}
        </button>
      </div>
    </section>
  );
}

function ReportSection({
  report,
  activeVersion,
  current,
  alreadyActive,
  busy,
  confirming,
  onConfirmToggle,
  onActivate,
}: {
  report: Report;
  activeVersion: number;
  current: PayoutActiveState;
  alreadyActive: boolean;
  busy: string;
  confirming: boolean;
  onConfirmToggle: () => void;
  onActivate: () => void;
}) {
  const { candidate, metrics } = report;
  const validated = candidate.status === 'VALIDATED';
  return (
    <section className="ops-section">
      <div className="ops-section-heading">
        <h2>Validated report · {candidate.candidateId}</h2>
        <span>hash {candidate.policyHash?.slice(0, 16)}</span>
      </div>

      <div className="ops-card-grid">
        <div className="ops-card">
          <span>Requested RTP</span>
          <strong>{percent(metrics.requestedRtpPercent)}</strong>
          <small>operator request</small>
        </div>
        <div className="ops-card">
          <span>Expected RTP</span>
          <strong>{percent(metrics.expectedRtpPercent)}</strong>
          <small>exact {metrics.expectedRtpPercentExact}%</small>
        </div>
        <div className="ops-card">
          <span>Measured RTP</span>
          <strong>{percent(metrics.measuredRtpPercent)}</strong>
          <small>
            95% CI {metrics.rtp95IntervalPercent
              ? `${metrics.rtp95IntervalPercent[0].toFixed(2)}–${metrics.rtp95IntervalPercent[1].toFixed(2)}%`
              : '—'}
          </small>
        </div>
        <div className="ops-card">
          <span>House edge</span>
          <strong>{percent(metrics.houseEdgePercent)}</strong>
          <small>exact {metrics.houseEdgePercentExact}%</small>
        </div>
        <div className="ops-card">
          <span>Declared model EV</span>
          <strong>{percent(metrics.declaredReturnPercent)}</strong>
          <small>the model&apos;s own return, not the policy target</small>
        </div>
        <div className={`ops-card ${validated && metrics.verdict === 'PASS' ? '' : 'ops-card-warn'}`}>
          <span>Evidence verdict</span>
          <strong className="ops-card-text">{metrics.verdict}</strong>
          <small>tolerance {metrics.tolerance}</small>
        </div>
      </div>

      <div className="ops-two-column" style={{ marginTop: 12 }}>
        <div>
          <div className="ops-section-heading"><h2>Generated weights</h2><span>reconciles to exactly 100%</span></div>
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead><tr><th>Class</th><th>Weight (units)</th><th>Percent</th></tr></thead>
              <tbody>
                {candidate.weights.length === 0 && (
                  <tr><td className="ops-empty" colSpan={3}>No solved weights.</td></tr>
                )}
                {candidate.weights.map((weight) => (
                  <tr key={weight.classId}>
                    <td>{weight.classId}</td>
                    <td>{weight.units.toLocaleString()}</td>
                    <td>{weight.percent.toFixed(4)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ops-safe-note">
            Authoritative weights are frozen with the candidate and cannot be edited here. The reconciliation
            error, if any, is absorbed on the final class so the displayed total is exactly 100%.
          </p>
        </div>
        <div>
          <div className="ops-section-heading"><h2>Outcome rates</h2><span>complete paid rounds</span></div>
          <div className="ops-card-grid">
            <div className="ops-card"><span>Loss (0x)</span><strong>{percent(metrics.lossRate)}</strong></div>
            <div className="ops-card"><span>Partial</span><strong>{percent(metrics.partialRate)}</strong></div>
            <div className="ops-card"><span>Break-even</span><strong>{percent(metrics.breakEvenRate)}</strong></div>
            <div className="ops-card"><span>Profitable</span><strong>{percent(metrics.profitableRate)}</strong></div>
            <div className="ops-card"><span>Hit</span><strong>{percent(metrics.hitRate)}</strong></div>
            <div className="ops-card"><span>Feature trigger</span><strong>{percent(metrics.featureTriggerRate)}</strong></div>
            <div className="ops-card"><span>Retrigger</span><strong>{percent(metrics.retriggerRate)}</strong></div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="ops-section-heading"><h2>Bankroll &amp; session evidence</h2><span>100 PTS · stake 0.20 PTS standard</span></div>
        <div className="ops-card-grid">
          <div className="ops-card"><span>Median paid session</span><strong>{points(metrics.paidSessionLength.median)}</strong><small>spins</small></div>
          <div className="ops-card"><span>P90 paid session</span><strong>{points(metrics.paidSessionLength.p90)}</strong><small>spins</small></div>
          <div className="ops-card"><span>Alive@500</span><strong>{ratio(metrics.alive500)}</strong></div>
          <div className="ops-card"><span>Alive@1000</span><strong>{ratio(metrics.alive1000)}</strong></div>
          <div className="ops-card"><span>Alive@5000</span><strong>{ratio(metrics.alive5000)}</strong></div>
          <div className="ops-card"><span>Turnover median</span><strong>{points(metrics.turnoverPts.median)}</strong><small>PTS</small></div>
          <div className="ops-card"><span>House result mean</span><strong>{points(metrics.houseResultPts.mean)}</strong><small>PTS / session</small></div>
          <div className="ops-card"><span>House result median</span><strong>{points(metrics.houseResultPts.median)}</strong><small>PTS / session</small></div>
          <div className="ops-card"><span>P90 full-loss streak</span><strong>{points(metrics.fullLossStreak.p90)}</strong><small>paid rounds</small></div>
          <div className="ops-card"><span>P95 full-loss streak</span><strong>{points(metrics.fullLossStreak.p95)}</strong><small>paid rounds</small></div>
          <div className="ops-card"><span>P90 non-profitable streak</span><strong>{points(metrics.nonProfitableStreakP90)}</strong><small>paid rounds</small></div>
          <div className="ops-card"><span>P90 drawdown</span><strong>{points(metrics.drawdownP90)}</strong><small>sim units (1 = 0.01 PTS)</small></div>
        </div>
        <p className="ops-safe-note">
          Full-loss streak: {metrics.drySpellDefinitions.fullLoss}. Non-profitable streak:{' '}
          {metrics.drySpellDefinitions.nonProfitable}.
        </p>
        <div className="ops-metrics">
          <span>
            Max paid spin <strong>{metrics.maxPaidSpinUnitsExact}</strong> · free spin{' '}
            <strong>{metrics.maxFreeSpinUnitsExact}</strong> · feature chain{' '}
            <strong>{metrics.maxFeatureChainUnitsExact}</strong> · cap <strong>{metrics.capUnitsExact}</strong>
          </span>
          <span>
            Paid within cap: <strong>{String(metrics.paidSpinWithinCap)}</strong> · free within cap:{' '}
            <strong>{String(metrics.freeSpinWithinCap)}</strong> · chain exceeds cap:{' '}
            <strong>{String(metrics.featureAggregateExceedsCap)}</strong>
          </span>
        </div>
        <p className="ops-safe-note">{CENSOR_NOTE}</p>
        <p className="ops-safe-note">{metrics.censoringCaveat}</p>
      </div>

      <div className="admin-platform" style={{ marginTop: 12 }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <strong>Activation</strong>
          <p className="ops-safe-note" style={{ marginTop: 4 }}>
            {alreadyActive
              ? 'This candidate is already the active policy. Activating it again records a new revision that is identical in mathematics.'
              : validated
                ? `Current revision ${activeVersion}. Activating applies to NEW paid rounds only; rounds in flight keep their pin.`
                : 'Activation is unavailable until the candidate is VALIDATED. The backend re-checks this regardless.'}
          </p>
          {confirming ? (
            <div className="admin-control-note">
              <p>Confirm this change before it applies to NEW paid rounds.</p>
              <div className="ops-metrics">
                <span>
                  CURRENT: <strong>{current.mode}</strong>
                  {current.mode === 'CUSTOM'
                    ? ` · ${percent(current.targetRtpPercent)} · ${current.maxWinMultiplier ?? '—'}x · ${current.style ?? '—'}`
                    : ' · golden RTP50 · default scope'}
                </span>
                <span>
                  NEW: <strong>{candidate.candidateId}</strong> · {percent(candidate.targetRtpPercent)} ·{' '}
                  {candidate.maxWinMultiplier}x · {candidate.style}
                </span>
              </div>
              <p className="ops-safe-note">
                Rounds already in flight keep their stored mathematics; only NEW paid rounds follow the new policy.
              </p>
              <div className="ops-refresh" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="ops-action" disabled={busy !== ''} onClick={onActivate}>
                  {busy === 'activate' ? 'Activating…' : 'Confirm activate'}
                </button>
                <button disabled={busy !== ''} onClick={onConfirmToggle}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="ops-refresh" style={{ marginTop: 8 }}>
              <button className="ops-action" disabled={busy !== '' || !validated} onClick={onConfirmToggle}>
                ACTIVATE
              </button>
            </div>
          )}
        </div>
      </div>

      <details style={{ marginTop: 12 }}>
        <summary>Raw server evidence {report.artifactPath && <small>· {report.artifactPath}</small>}</summary>
        <pre className="admin-audit-meta" style={{ maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {JSON.stringify(report.metrics, null, 2)}
        </pre>
      </details>
    </section>
  );
}
