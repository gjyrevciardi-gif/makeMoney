import { z } from 'zod';
export const sportSchema = z.object({ key: z.string().min(1), title: z.string().min(1), active: z.boolean(), group: z.string().min(1).optional() });
const outcome = z.object({ name: z.string().min(1), price: z.number().positive().finite(), point: z.number().finite().optional() });
/**
 * The markets this product understands and prices. Anything else the provider
 * returns is parsed and then dropped by the provider.
 */
export const SUPPORTED_MARKET_KEYS = ['h2h', 'spreads', 'totals'] as const;
export type SupportedMarketKey = (typeof SUPPORTED_MARKET_KEYS)[number];
export const isSupportedMarketKey = (key: string): key is SupportedMarketKey =>
  (SUPPORTED_MARKET_KEYS as readonly string[]).includes(key);
/**
 * `key` is deliberately an open string rather than an enum.
 *
 * Requesting `markets=h2h,spreads,totals` does not guarantee those are the only
 * keys that come back: betting exchanges in the `eu` region also quote the lay
 * side as `h2h_lay`. An enum here failed the *entire* response over one extra
 * key, so a single exchange listing took a whole competition offline. Unknown
 * markets are accepted by the schema and filtered out afterwards instead.
 */
const market = z.object({ key: z.string().min(1), outcomes: z.array(outcome) });
const bookmaker = z.object({ key: z.string().min(1), title: z.string().min(1), markets: z.array(market) });
export const eventSchema = z.object({ id: z.string().min(1), sport_key: z.string().min(1), sport_title: z.string().min(1), commence_time: z.string().datetime(), home_team: z.string().min(1), away_team: z.string().min(1), bookmakers: z.array(bookmaker).optional() });
export type ProviderEvent = z.infer<typeof eventSchema>;
