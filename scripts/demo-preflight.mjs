#!/usr/bin/env node
// Pre-presentation check: run this 10-15 minutes before the buyer demo.
//
//   node scripts/demo-preflight.mjs
//
// It answers the question the operator would otherwise have to answer by
// clicking around while the buyer watches: which fixture is worth showing right
// now, is anything actually live, and do the external demo links still open.
// Everything it reports comes from the provider through our own API - it never
// invents a fixture, a score or a market.
//
// It is also deliberately quota-frugal: it probes a small number of sports, then
// warms the odds cache only for the handful of events it recommends, so the
// demo itself is served from Redis rather than from the provider.

import { DEMO, loadDemoEnv } from './demo/env.mjs';
import { readDemoAccounts } from './demo/seed.mjs';

const API = `http://${DEMO.host}:${DEMO.backendPort}`;
const WEB = `http://${DEMO.host}:${DEMO.frontendPort}`;
/** How many sports to look at before settling. Each one is a provider call. */
const SPORT_BUDGET = 6;
/** How many events to warm per recommendation list. */
const WARM_LIMIT = 3;

const env = loadDemoEnv();
const line = (s = '') => console.log(s);
const head = (s) => { line(); line(s); line('-'.repeat(s.length)); };

const api = async (path, { token } = {}) => {
  const res = await fetch(`${API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
};

async function adminToken() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.DEMO_ADMIN_EMAIL, password: env.DEMO_ADMIN_PASSWORD }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`admin login failed: HTTP ${res.status}`);
  return (await res.json()).accessToken;
}

// The board exposes the fixture as internalEventId/competitionName/startTime -
// there is no bare `id`, and reading one silently produces /events/undefined.
const eventId = (row) => row?.event?.internalEventId ?? row?.event?.providerEventId;
// A fixture counts as live only when the provider actually reports a live state
// for it. Status alone is not enough: STARTED_UNKNOWN simply means kick-off has
// passed, so it also matches matches that finished hours ago, and presenting one
// of those as live is exactly the thing this script exists to prevent.
const isLive = (row) => Boolean(row?.live);
const teams = (row) => `${row?.event?.homeTeam ?? '?'} v ${row?.event?.awayTeam ?? '?'}`;
// The event page reads ?sport= (not ?sportKey=); with the wrong name it renders
// "This event link is incomplete", which is the last thing an operator needs to
// meet after pasting a link from this report.
const eventUrl = (row) => `${WEB}/sports/event/${eventId(row)}?sport=${encodeURIComponent(row.event.sportKey)}`;

const describeLive = (live) => {
  if (!live) return 'no live state';
  const score = live.homeScore !== undefined && live.awayScore !== undefined
    ? `${live.homeScore}-${live.awayScore}` : 'no score';
  const clock = live.minute !== undefined ? `${live.minute}'` : (live.status ?? 'no clock');
  return `${score} @ ${clock}`;
};

// ---------------------------------------------------------------------------

async function checkStack() {
  head('1. STACK');
  for (const [label, url] of [['backend ', `${API}/health/ready`], ['frontend', WEB]]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      line(`  ${label} ${url}  HTTP ${res.status}${res.ok ? '' : '  <-- NOT READY'}`);
    } catch (error) {
      line(`  ${label} ${url}  DOWN (${error?.message ?? error})  <-- run: npm run demo:up`);
      return false;
    }
  }
  return true;
}

async function checkAccounts() {
  head('2. DEMO ACCOUNTS');
  try {
    const accounts = await readDemoAccounts(env, { api: API });
    let ok = true;
    for (const a of accounts) {
      const expected = a.role === 'PLAYER' ? String(DEMO.playerGrantPts) : null;
      const flag = expected && a.balance !== expected ? `  <-- expected ${expected}; run npm run demo:reset` : '';
      if (flag) ok = false;
      line(`  ${a.role.padEnd(6)} ${a.email.padEnd(32)} ${String(a.balance).padStart(7)} PTS${flag}`);
    }
    return ok;
  } catch (error) {
    line(`  unavailable (${error?.message ?? error})`);
    return false;
  }
}

async function checkProviders(token) {
  head('3. SPORTS PROVIDERS');
  const res = await api('/admin/providers/sports/providers', { token });
  if (res.status !== 200) {
    line(`  provider status unavailable (HTTP ${res.status})`);
    return;
  }
  for (const p of res.body?.providers ?? []) {
    const quota = p.remainingQuota !== undefined && p.remainingQuota !== null ? `, ${p.remainingQuota} requests left` : '';
    const failure = p.lastErrorCode ? `  last error: ${p.lastErrorCode}${p.lastErrorStatus ? ` (${p.lastErrorStatus})` : ''}` : '';
    line(`  ${String(p.provider).padEnd(18)} ${p.configured ? 'configured' : 'NOT configured'}${quota}${failure}`);
  }
}

/**
 * Walk a bounded number of sports and collect every event the provider is
 * currently offering, so pre-match and live can both be ranked from real data.
 */
async function collectEvents() {
  const sports = await api('/sports');
  if (sports.status !== 200) throw new Error(`GET /sports returned HTTP ${sports.status}`);
  const active = (sports.body ?? []).filter((s) => s.active !== false);
  // Soccer first: it is the sport with the richest market coverage here.
  const ordered = [
    ...active.filter((s) => /soccer/i.test(s.group ?? s.key)),
    ...active.filter((s) => !/soccer/i.test(s.group ?? s.key)),
  ].slice(0, SPORT_BUDGET);

  const rows = [];
  for (const sport of ordered) {
    const board = await api(`/sports/${encodeURIComponent(sport.key)}/board`);
    if (board.status !== 200) {
      line(`  ${sport.key}: board unavailable (HTTP ${board.status})`);
      continue;
    }
    for (const event of board.body?.events ?? []) {
      rows.push({ ...event, sportName: board.body.sportName ?? sport.name });
    }
  }
  return rows;
}

/** Fetching odds both measures a fixture's real depth and warms its cache. */
async function warm(rows) {
  const warmed = [];
  for (const row of rows) {
    const res = await api(`/sports/events/${eventId(row)}/odds?sportKey=${encodeURIComponent(row.event.sportKey)}`);
    if (res.status !== 200) {
      line(`  ! ${teams(row)}: odds unavailable (HTTP ${res.status}) - not recommending it`);
      continue;
    }
    const groups = new Set((res.body?.markets ?? []).map((m) => m.group).filter(Boolean));
    warmed.push({
      row,
      marketCount: res.body?.marketCount ?? (res.body?.markets ?? []).length,
      mapped: (res.body?.markets ?? []).length,
      groups: [...groups],
      live: res.body?.live,
    });
  }
  return warmed;
}

async function sportsShowcase() {
  head('4. SPORTSBOOK - WARMING AND CHOOSING FIXTURES');
  let rows;
  try { rows = await collectEvents(); }
  catch (error) { line(`  sportsbook unavailable: ${error?.message ?? error}`); return { prematch: [], live: [] }; }
  line(`  provider returned ${rows.length} events across the sports probed`);

  const live = rows.filter(isLive);
  const prematch = rows.filter((r) => !isLive(r));
  const byDepth = (a, b) => (b.markets?.length ?? 0) - (a.markets?.length ?? 0);
  // Only ever recommend a pre-match fixture that has not kicked off.
  const upcoming = prematch.filter((r) => r.event?.status === 'UPCOMING');

  head('4a. BEST PRE-MATCH FIXTURES (cache warmed)');
  const warmedPre = await warm([...(upcoming.length ? upcoming : prematch)].sort(byDepth).slice(0, WARM_LIMIT));
  for (const w of warmedPre) {
    line(`  ${teams(w.row)}`);
    line(`     ${w.row.event.competitionName ?? w.row.sportName ?? ''} | starts ${w.row.event.startTime ?? '?'}`);
    line(`     ${w.marketCount} provider markets, ${w.mapped} shown | groups: ${w.groups.join(', ') || 'none'}`);
    line(`     ${eventUrl(w.row)}`);
  }
  if (!warmedPre.length) line('  none available right now');

  head('4b. LIVE FIXTURES (real score and clock only)');
  if (!live.length) {
    line('  nothing is live at this moment.');
    line('  Show the pre-match fixture above instead - do not promise a live game that does not exist.');
  } else {
    // A live card with no priced market is not worth showing a buyer.
    const priced = live.filter((r) => (r.markets?.length ?? 0) > 0);
    const warmedLive = await warm([...(priced.length ? priced : live)].sort(byDepth).slice(0, WARM_LIMIT));
    for (const w of warmedLive) {
      line(`  ${teams(w.row)}   ${describeLive(w.live ?? w.row.live)}`);
      line(`     LIVE now - verify the score on screen matches this before presenting`);
      line(`     ${w.row.event.competitionName ?? w.row.sportName ?? ''}`);
      line(`     ${w.marketCount} provider markets, ${w.mapped} shown | groups: ${w.groups.join(', ') || 'none'}`);
      line(`     ${eventUrl(w.row)}`);
    }
    return { prematch: warmedPre, live: warmedLive };
  }
  return { prematch: warmedPre, live: [] };
}

/**
 * The lobby must not show a card that leads nowhere, so every external demo URL
 * is re-checked against the provider's own site immediately before the demo.
 */
async function checkExternalDemos() {
  head('5. EXTERNAL PROVIDER DEMO GAMES');
  const mod = await import('../frontend/lib/external-demo-games.ts');
  const games = mod.EXTERNAL_DEMO_GAMES;
  const results = [];
  for (const game of games) {
    let status = 'unreachable';
    try {
      const res = await fetch(game.demoUrl, {
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(15_000),
      });
      status = `HTTP ${res.status}`;
    } catch (error) {
      status = `failed (${error?.message ?? error})`;
    }
    const ok = status === 'HTTP 200';
    results.push({ game, status, ok });
    line(`  ${ok ? 'OK  ' : 'WARN'} ${String(game.provider).padEnd(14)} ${String(game.name).padEnd(44)} ${status}`);
  }
  const broken = results.filter((r) => !r.ok);
  if (broken.length) {
    line();
    line(`  ${broken.length} link(s) did not return 200. Do not open these during the demo:`);
    for (const b of broken) line(`     - ${b.game.provider} ${b.game.name}`);
  }
  return results;
}

// ---------------------------------------------------------------------------

(async () => {
  line('='.repeat(72));
  line(`  BUYER DEMO PREFLIGHT   ${new Date().toISOString()}`);
  line('='.repeat(72));

  const stackUp = await checkStack();
  if (!stackUp) { line('\nStack is not running - start it with `npm run demo:up` and re-run.'); process.exit(1); }

  const accountsOk = await checkAccounts();
  const token = await adminToken();
  await checkProviders(token);
  const sports = await sportsShowcase();
  const demos = await checkExternalDemos();

  head('6. VERDICT');
  const liveOk = sports.live.length > 0;
  const preOk = sports.prematch.length > 0;
  const demosOk = demos.filter((d) => d.ok).length;
  line(`  demo accounts funded ............ ${accountsOk ? 'yes' : 'NO - run npm run demo:reset'}`);
  line(`  rich pre-match fixture ready .... ${preOk ? 'yes' : 'NO'}`);
  line(`  live fixture available .......... ${liveOk ? 'yes' : 'no - present pre-match instead'}`);
  line(`  external demo links working ..... ${demosOk}/${demos.length}`);
  line();
  line(`  Open ${WEB} and leave the PLAYER logged in on the Sports page.`);
  line('='.repeat(72));
})().catch((error) => {
  console.error(`\npreflight failed: ${error?.message ?? error}`);
  process.exit(1);
});
