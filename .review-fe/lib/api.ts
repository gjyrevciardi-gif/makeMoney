const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
let accessToken: string | undefined;
let refreshInFlight: Promise<string | undefined> | undefined;

/**
 * Only the API base URL is read from the environment, and only from the
 * `NEXT_PUBLIC_` namespace. No provider key, JWT secret, database URL or seed
 * is ever referenced from browser code.
 */
export const apiBaseUrl = () => API;

/** Drops the in-memory token so a signed-out tab cannot keep using it. */
export function clearAccessToken() {
  accessToken = undefined;
}

export function refreshAccessToken() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = fetch(`${API}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
    .then(async response => {
      if (!response.ok) {
        accessToken = undefined;
        return undefined;
      }

      const body = await response.json() as { accessToken?: unknown };
      if (typeof body.accessToken !== 'string' || !body.accessToken) {
        accessToken = undefined;
        return undefined;
      }
      accessToken = body.accessToken;
      return accessToken;
    })
    .catch(() => {
      accessToken = undefined;
      return undefined;
    })
    .finally(() => {
      refreshInFlight = undefined;
    });

  return refreshInFlight;
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  if (!accessToken) await refreshAccessToken();

  const headers = new Headers(init.headers);
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  const tokenUsed = accessToken;

  let response = await fetch(`${API}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (response.status === 401) {
    const retryToken = accessToken && accessToken !== tokenUsed
      ? accessToken
      : await refreshAccessToken();

    if (retryToken) {
      headers.set('authorization', `Bearer ${retryToken}`);
      response = await fetch(`${API}${path}`, {
        ...init,
        headers,
        credentials: 'include',
      });
    }
  }

  return response;
}

/** Public (unauthenticated) reads such as the sports catalogue. */
export const publicFetch = (path: string, init: RequestInit = {}) =>
  fetch(`${API}${path}`, { ...init, credentials: 'omit' });

/**
 * A safe, code-carrying error.
 *
 * The backend answers failures with `{ code, message }`. The `code` is what the
 * UI branches on; the raw body is never surfaced, so a provider exception or
 * stack trace can never reach the page.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Body = Record<string, unknown> | undefined;

async function parse(response: Response) {
  const text = await response.text();
  if (!text) return undefined;
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}

/** Throws `ApiError` on any non-2xx, so callers never branch on status codes. */
export async function request<T>(
  path: string,
  init: RequestInit = {},
  options: { public?: boolean } = {},
): Promise<T> {
  const response = options.public
    ? await publicFetch(path, init)
    : await apiFetch(path, init);
  const payload = await parse(response);

  if (!response.ok) {
    const body = (payload ?? {}) as { code?: unknown; message?: unknown };
    const code = typeof body.code === 'string'
      ? body.code
      : response.status === 401
        ? 'UNAUTHENTICATED'
        : response.status === 403
          ? 'FORBIDDEN'
          : 'REQUEST_FAILED';
    const message = typeof body.message === 'string' ? body.message : 'Request failed.';
    throw new ApiError(code, message, response.status, payload);
  }

  return payload as T;
}

export const getJson = <T>(path: string, options?: { public?: boolean }) =>
  request<T>(path, {}, options);

export const postJson = <T>(path: string, body?: Body) =>
  request<T>(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const patchJson = <T>(path: string, body?: Body) =>
  request<T>(path, { method: 'PATCH', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const deleteJson = <T>(path: string) => request<T>(path, { method: 'DELETE' });

export const newIdempotencyKey = () => crypto.randomUUID();
