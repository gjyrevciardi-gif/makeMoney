/**
 * Thin HTTP client for the accepted Nest backend.
 *
 * It performs exactly the flows the running application exposes: register,
 * login, cookie-refresh, the private wallet views, the append-only admin grant
 * and the four Book of the Sands player routes. Nothing here fabricates a
 * balance, a board, a payout or a token.
 */
import { httpJson, fail } from './lib.mjs';

export class NestClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async request(path, { method = 'GET', body, token, cookie, headers = {} } = {}) {
    const response = await httpJson(`${this.baseUrl}${path}`, {
      method,
      body,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
    });
    return response;
  }

  async ok(path, options) {
    const response = await this.request(path, options);
    if (!response.ok) {
      const message = typeof response.payload === 'object' ? JSON.stringify(response.payload) : String(response.payload);
      fail(`${options?.method ?? 'GET'} ${path} failed with ${response.status}: ${message}`);
    }
    return response;
  }

  static refreshCookieValue(setCookie) {
    const entry = setCookie.find((value) => value.startsWith('refresh_token='));
    if (!entry) return undefined;
    return entry.split(';')[0];
  }

  register(email, password) {
    return this.request('/auth/register', { method: 'POST', body: { email, password } });
  }

  async login(email, password) {
    const response = await this.request('/auth/login', { method: 'POST', body: { email, password } });
    return {
      ...response,
      refreshCookie: NestClient.refreshCookieValue(response.setCookie),
    };
  }

  async refresh(refreshCookie) {
    const response = await this.request('/auth/refresh', { method: 'POST', cookie: refreshCookie });
    return {
      ...response,
      refreshCookie: NestClient.refreshCookieValue(response.setCookie) ?? refreshCookie,
    };
  }

  me(token) {
    return this.ok('/users/me', { token });
  }

  wallet(token) {
    return this.ok('/wallet/me', { token });
  }

  ledger(token, limit = 25) {
    return this.ok(`/wallet/me/ledger?limit=${limit}`, { token });
  }

  adminUsers(token, search) {
    return this.ok(`/admin/users?limit=25${search ? `&search=${encodeURIComponent(search)}` : ''}`, { token });
  }

  grantCoins(adminToken, userId, amount, reason, idempotencyKey) {
    return this.request(`/admin/users/${userId}/coins`, {
      method: 'POST',
      token: adminToken,
      body: { amount, reason, idempotencyKey },
    });
  }

  bookConfig(token) {
    return this.request('/casino/book-of-ra/config', { token });
  }

  bookState(token) {
    return this.request('/casino/book-of-ra/state', { token });
  }

  bookSpin(token, body, idempotencyKey) {
    return this.request('/casino/book-of-ra/spin', {
      method: 'POST',
      token,
      headers: { 'idempotency-key': idempotencyKey },
      body,
    });
  }

  bookAction(token, body, idempotencyKey) {
    return this.request('/casino/book-of-ra/action', {
      method: 'POST',
      token,
      headers: { 'idempotency-key': idempotencyKey },
      body,
    });
  }
}

/**
 * Ensures a local test account exists and returns a live session.
 *
 * The register route is rate limited per IP, so a repeat run logs in first and
 * only falls back to registration when the account genuinely does not exist.
 */
export async function ensureAccount(nest, email, password) {
  const existing = await nest.login(email, password);
  if (existing.ok) return { created: false, session: existing };
  if (existing.status !== 401) {
    fail(`Login for ${email} failed with ${existing.status}: ${JSON.stringify(existing.payload)}`);
  }
  const registered = await nest.register(email, password);
  if (!registered.ok && registered.status !== 409) {
    fail(`Registration for ${email} failed with ${registered.status}: ${JSON.stringify(registered.payload)}`);
  }
  const session = await nest.login(email, password);
  if (!session.ok) {
    fail(`Login after registration for ${email} failed with ${session.status}: ${JSON.stringify(session.payload)}`);
  }
  return { created: registered.ok, session };
}
