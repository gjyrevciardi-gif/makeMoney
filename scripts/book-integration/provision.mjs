/**
 * Local test provisioning through the application's own endpoints.
 *
 * Two ignored-config test accounts are registered with `/auth/register`, the
 * first one is promoted with the repository's `scripts/bootstrap-admin.js`
 * (audited, test database only), and the player wallet is funded through the
 * existing append-only `/admin/users/:userId/coins` grant with a persisted
 * idempotency key. No balance is ever written directly.
 */
import path from 'node:path';
import { LOOPBACK, loadIntegrationEnv, log, redisCliBin, root, run } from './lib.mjs';
import { NestClient, ensureAccount } from './nest.mjs';
import { assertLocalTestTarget } from './setup.mjs';
import { assertRedisOwned } from './services.mjs';

async function promoteFirstAdmin(env, email) {
  const result = await run(['node', path.join('scripts', 'bootstrap-admin.js')], {
    env: {
      ...env,
      BOOTSTRAP_ADMIN_EMAIL: email,
      CONFIRM_ADMIN_BOOTSTRAP: 'GRANT_ADMIN',
    },
    timeoutMs: 120_000,
    log: path.join(root, 'tmp', 'integration', 'logs', 'bootstrap-admin.log'),
  });
  const already = result.output.includes('an admin already exists');
  if (result.code !== 0 && !already) {
    throw new Error('Admin bootstrap failed. See tmp/integration/logs/bootstrap-admin.log.');
  }
  return already ? 'already-present' : 'promoted';
}

/**
 * Clears only `rate:*` keys from the dedicated integration Redis instance.
 *
 * The register route allows three requests per hour per IP, so a repeat of the
 * one-time account creation would otherwise be blocked by our own earlier run.
 * Nothing else is deleted, and no key outside this instance is touched.
 */
async function clearRateLimitKeys(env) {
  // Only this stack's own Redis may be cleared.
  await assertRedisOwned(Number(env.INTEGRATION_REDIS_PORT));
  const base = [redisCliBin, '-h', LOOPBACK, '-p', String(env.INTEGRATION_REDIS_PORT)];
  // The bundled Windows redis-cli 3.x does not support `--scan --pattern`, so the
  // dedicated instance is enumerated directly; its keyspace only ever holds the
  // rate-limit counters of this stack.
  const listed = await run([...base, 'keys', 'rate:*'], { timeoutMs: 20_000 });
  const keys = listed.output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.startsWith('rate:'));
  if (!keys.length) return 0;
  await run([...base, 'del', ...keys], { timeoutMs: 20_000 });
  return keys.length;
}

export async function provisionLocalTestAccounts(env) {
  const config = env ?? (await loadIntegrationEnv());
  assertLocalTestTarget(config);
  const nest = new NestClient(`http://127.0.0.1:${config.INTEGRATION_BACKEND_PORT}`);
  const cleared = await clearRateLimitKeys(config);
  if (cleared) log('INTEGRATION_RATE_KEYS_CLEARED', { keys: cleared });

  const player = await ensureAccount(nest, config.INTEGRATION_PLAYER_EMAIL, config.INTEGRATION_PLAYER_PASSWORD);
  const admin = await ensureAccount(nest, config.INTEGRATION_ADMIN_EMAIL, config.INTEGRATION_ADMIN_PASSWORD);

  let adminSession = admin.session;
  if (adminSession.payload.user.role !== 'ADMIN') {
    await promoteFirstAdmin(config, config.INTEGRATION_ADMIN_EMAIL);
    adminSession = await nest.login(config.INTEGRATION_ADMIN_EMAIL, config.INTEGRATION_ADMIN_PASSWORD);
    if (!adminSession.ok || adminSession.payload.user.role !== 'ADMIN') {
      throw new Error('The local test administrator was not promoted; refusing to continue.');
    }
  }

  const adminToken = adminSession.payload.accessToken;
  const playerId = player.session.payload.user.id;
  const grant = await nest.grantCoins(
    adminToken,
    playerId,
    Number(config.INTEGRATION_FUND_AMOUNT),
    config.INTEGRATION_GRANT_REASON,
    config.INTEGRATION_FUND_KEY,
  );
  if (!grant.ok) {
    throw new Error(`Funding the local test player failed with ${grant.status}: ${JSON.stringify(grant.payload)}`);
  }

  const wallet = await nest.wallet(player.session.payload.accessToken);
  log('LOCAL_TEST_ACCOUNTS_READY', {
    player: config.INTEGRATION_PLAYER_EMAIL,
    playerBalance: String(wallet.payload.balance),
    admin: config.INTEGRATION_ADMIN_EMAIL,
    registeredPlayer: player.created,
    registeredAdmin: admin.created,
    grantDuplicate: grant.payload.duplicate === true,
    credentials: 'stored in .env.integration (ignored; read INTEGRATION_PLAYER_EMAIL / INTEGRATION_PLAYER_PASSWORD)',
  });
  return { playerId, balance: String(wallet.payload.balance) };
}

if (process.argv[1] && process.argv[1].endsWith('provision.mjs')) {
  await provisionLocalTestAccounts();
}
