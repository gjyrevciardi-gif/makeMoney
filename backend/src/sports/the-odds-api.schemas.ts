import { z } from 'zod';
export const sportSchema = z.object({ key: z.string().min(1), title: z.string().min(1), active: z.boolean(), group: z.string().min(1).optional() });
const outcome = z.object({ name: z.string().min(1), price: z.number().positive().finite(), point: z.number().finite().optional() });
const market = z.object({ key: z.enum(['h2h', 'spreads', 'totals']), outcomes: z.array(outcome).min(1) });
const bookmaker = z.object({ key: z.string().min(1), title: z.string().min(1), markets: z.array(market) });
export const eventSchema = z.object({ id: z.string().min(1), sport_key: z.string().min(1), sport_title: z.string().min(1), commence_time: z.string().datetime(), home_team: z.string().min(1), away_team: z.string().min(1), bookmakers: z.array(bookmaker).optional() });
export type ProviderEvent = z.infer<typeof eventSchema>;
