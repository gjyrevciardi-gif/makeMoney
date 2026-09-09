const integer = (name: string, fallback: number) => { const value = Number(process.env[name] ?? fallback); return Number.isInteger(value) && value > 0 ? value : fallback; };
export const sportsConfig = () => ({
  apiKey: process.env.THE_ODDS_API_KEY?.trim() || undefined,
  baseUrl: (process.env.THE_ODDS_API_BASE_URL ?? 'https://api.the-odds-api.com/v4').replace(/\/$/, ''),
  provider: process.env.SPORTS_PROVIDER ?? 'the-odds-api',
  timeoutMs: integer('SPORTS_PROVIDER_TIMEOUT_MS', 5000),
  ttl: { sports: integer('SPORTS_CACHE_TTL_SECONDS', 3600), events: integer('EVENTS_CACHE_TTL_SECONDS', 120), odds: integer('ODDS_CACHE_TTL_SECONDS', 20) },
  bookmakers: (process.env.PRIMARY_BOOKMAKER_KEYS ?? '').split(',').map(x => x.trim()).filter(Boolean),
});
