// Demo account provisioning.
//
// Every account is created the way a real user's would be: POST /auth/register,
// the existing controlled admin bootstrap, and a normal admin grant through
// POST /admin/users/:id/coins. Nothing here writes to the User or Wallet tables
// directly, so the demo exercises the same code path the buyer is being shown -
// and the grant leaves a real ledger entry and audit record behind.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { DEMO, ROOT } from './env.mjs';

// Fixed so re-running the seeder against an already-funded demo is a no-op
// rather than a second grant.
const GRANT_IDEMPOTENCY_KEY = '3f1c9a6e-5d47-4c2b-9f8a-0b7d2e4a6c15';

const request = async (api, path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
};

const requireCredentials = (env) => {
  const missing = ['DEMO_ADMIN_EMAIL', 'DEMO_ADMIN_PASSWORD', 'DEMO_PLAYER_EMAIL', 'DEMO_PLAYER_PASSWORD']
    .filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(
      `Missing ${missing.join(', ')} in .env.demo.\n` +
      '  The seeder never invents credentials. Add them to .env.demo (gitignored) and re-run.',
    );
  }
};

/** Registration is idempotent for our purposes: an existing account is fine. */
async function ensureRegistered(api, email, password) {
  const res = await request(api, '/auth/register', { method: 'POST', body: { email, password } });
  if (res.status === 201 || res.status === 200) return { created: true, balance: String(res.body?.balance ?? '0') };
  if (res.status === 409) return { created: false, balance: null };
  throw new Error(`register ${email} failed: HTTP ${res.status} ${JSON.stringify(res.body)}`);
}

async function login(api, email, password) {
  const res = await request(api, '/auth/login', { method: 'POST', body: { email, password } });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`login ${email} failed: HTTP ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.accessToken, user: res.body.user };
}

const runNode = (script, env) => new Promise((resolvePromise, reject) => {
  const child = spawn(process.execPath, [script], { cwd: ROOT, env, stdio: 'pipe' });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('error', reject);
  child.on('close', (code) => (code === 0 ? resolvePromise(out.trim()) : reject(new Error(out.trim() || `exit ${code}`))));
});

/**
 * Promote the demo admin using the repository's own bootstrap script, which
 * refuses to run if an admin already exists. We therefore ask the API first
 * whether the account can already reach /admin, and only bootstrap when it
 * cannot.
 */
async function ensureAdminRole(api, env, token) {
  const probe = await request(api, '/admin/users?limit=1', { token });
  if (probe.status === 200) return 'already-admin';
  if (probe.status !== 403) throw new Error(`admin probe returned HTTP ${probe.status}`);
  await runNode(resolve(ROOT, 'scripts', 'bootstrap-admin.js'), {
    ...env,
    BOOTSTRAP_ADMIN_EMAIL: env.DEMO_ADMIN_EMAIL,
    CONFIRM_ADMIN_BOOTSTRAP: 'GRANT_ADMIN',
  });
  return 'bootstrapped';
}

async function findUser(api, token, email) {
  const res = await request(api, `/admin/users?limit=100&search=${encodeURIComponent(email)}`, { token });
  if (res.status !== 200) throw new Error(`user lookup failed: HTTP ${res.status}`);
  const found = (res.body ?? []).find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!found) throw new Error(`user ${email} not found after registration`);
  return found;
}

const balanceOf = (user) => String(user?.wallet?.balance ?? '0');

export async function seedDemoAccounts(env, { api }) {
  requireCredentials(env);
  const notes = [];

  // ADMIN: register, then promote through the controlled bootstrap path.
  const adminReg = await ensureRegistered(api, env.DEMO_ADMIN_EMAIL, env.DEMO_ADMIN_PASSWORD);
  let adminSession = await login(api, env.DEMO_ADMIN_EMAIL, env.DEMO_ADMIN_PASSWORD);
  const adminRole = await ensureAdminRole(api, env, adminSession.token);
  if (adminRole === 'bootstrapped') {
    // The old access token still carries role USER; re-login to pick up ADMIN.
    adminSession = await login(api, env.DEMO_ADMIN_EMAIL, env.DEMO_ADMIN_PASSWORD);
  }
  notes.push(`admin ${adminReg.created ? 'registered' : 'already existed'}, ${adminRole}`);

  // PLAYER: register and confirm a brand-new account really does start at zero.
  const playerReg = await ensureRegistered(api, env.DEMO_PLAYER_EMAIL, env.DEMO_PLAYER_PASSWORD);
  if (playerReg.created && playerReg.balance !== '0') {
    throw new Error(`New registration started at ${playerReg.balance} PTS, expected 0.`);
  }
  notes.push(`player ${playerReg.created ? 'registered at 0 PTS' : 'already existed'}`);

  const player = await findUser(api, adminSession.token, env.DEMO_PLAYER_EMAIL);
  const before = BigInt(balanceOf(player));

  // Fund through the real admin grant so the ledger and audit trail are genuine.
  if (before < BigInt(DEMO.playerGrantPts)) {
    const grant = await request(api, `/admin/users/${player.id}/coins`, {
      method: 'POST',
      token: adminSession.token,
      body: {
        amount: DEMO.playerGrantPts - Number(before),
        reason: DEMO.grantReason,
        idempotencyKey: GRANT_IDEMPOTENCY_KEY,
      },
    });
    if (grant.status !== 201 && grant.status !== 200) {
      throw new Error(`ADMIN_GRANT failed: HTTP ${grant.status} ${JSON.stringify(grant.body)}`);
    }
    notes.push(`granted ${DEMO.playerGrantPts - Number(before)} PTS (${DEMO.grantReason})`);
  } else {
    notes.push('player already funded');
  }

  const accounts = await readDemoAccounts(env, { api, token: adminSession.token });
  const funded = accounts.find((a) => a.role === 'PLAYER');
  if (BigInt(funded.balance) !== BigInt(DEMO.playerGrantPts)) {
    throw new Error(`Player balance is ${funded.balance} PTS, expected ${DEMO.playerGrantPts}.`);
  }
  for (const note of notes) console.log(`  ${note}`);
  return accounts;
}

export async function readDemoAccounts(env, { api, token } = {}) {
  requireCredentials(env);
  const session = token ? { token } : await login(api, env.DEMO_ADMIN_EMAIL, env.DEMO_ADMIN_PASSWORD);
  const out = [];
  for (const [role, email] of [['ADMIN', env.DEMO_ADMIN_EMAIL], ['PLAYER', env.DEMO_PLAYER_EMAIL]]) {
    const user = await findUser(api, session.token, email);
    out.push({ role, email, id: user.id, balance: balanceOf(user) });
  }
  return out;
}
