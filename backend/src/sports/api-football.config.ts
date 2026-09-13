const integer = (name: string, fallback: number) => { const value = Number(process.env[name] ?? fallback); return Number.isInteger(value) && value > 0 ? value : fallback; };
const ids = (name: string) => (process.env[name] ?? '').split(',').map(x => x.trim()).filter(Boolean);

/**
 * API-Football configuration.
 *
 * The key is read here and nowhere else, is never placed in a URL (the provider
 * sends it as the `x-apisports-key` header), and is never logged or returned by
 * any status endpoint — `configured` below is the only thing that leaves the
 * backend (§2, §12).
 *
 * TTLs follow the quota shape of the free tier (§9): reference data is stable
 * for a day, pre-match prices for minutes, live prices for seconds and only
 * while a fixture is actually running.
 */
export const apiFootballConfig = () => ({
  apiKey: process.env.API_FOOTBALL_KEY?.trim() || undefined,
  baseUrl: (process.env.API_FOOTBALL_BASE_URL ?? 'https://v3.football.api-sports.io').replace(/\/$/, ''),
  /** Soccer uses API-Football only when this is on AND a key is present. */
  enabled: (process.env.API_FOOTBALL_ENABLED ?? 'true').toLowerCase() !== 'false',
  timeoutMs: integer('API_FOOTBALL_TIMEOUT_MS', 6000),
  ttl: {
    reference: integer('API_FOOTBALL_REFERENCE_CACHE_TTL_SECONDS', 86400),
    prematch: integer('API_FOOTBALL_PREMATCH_CACHE_TTL_SECONDS', 300),
    live: integer('API_FOOTBALL_LIVE_CACHE_TTL_SECONDS', 10),
  },
  /** Restrict normalization to these bookmaker ids when the provider returns many. */
  bookmakerIds: ids('API_FOOTBALL_BOOKMAKER_IDS').map(Number).filter(Number.isFinite),
});

export const isApiFootballConfigured = () => {
  const config = apiFootballConfig();
  return config.enabled && Boolean(config.apiKey);
};
