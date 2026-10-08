import { z } from 'zod';

/**
 * Schemas transcribed from responses captured in the discovery spike (§3), with
 * sanitized copies of those exact payloads in test/fixtures/api-football.
 *
 * Fields the provider returns but we do not consume (logos, flags, referee,
 * venue) are not modelled. Every object is therefore permissive about unknown
 * keys but strict about the ones we read, so a provider adding a field cannot
 * break parsing while a provider changing a field we depend on still fails
 * loudly instead of silently yielding an empty board.
 *
 * `null` appears in real payloads far more than the documentation implies —
 * `elapsed`, `goals`, `winner`, `handicap` and `main` are all nullable in data
 * we actually received — so nullability here is observed, not assumed.
 */

export const leagueSeason = z.object({
  year: z.number(),
  current: z.boolean().optional(),
  coverage: z.object({ odds: z.boolean().optional() }).partial().optional(),
});

export const leagueEntry = z.object({
  league: z.object({ id: z.number(), name: z.string(), type: z.string().optional() }),
  country: z.object({ name: z.string().nullable().optional(), code: z.string().nullable().optional() }).optional(),
  seasons: z.array(leagueSeason).optional(),
});

/** `/fixtures` — the only endpoint that carries team NAMES and half-time score. */
export const fixtureEntry = z.object({
  fixture: z.object({
    id: z.number(),
    date: z.string(),
    timestamp: z.number().optional(),
    status: z.object({
      long: z.string(),
      short: z.string(),
      elapsed: z.number().nullable().optional(),
    }),
  }),
  league: z.object({ id: z.number(), name: z.string(), country: z.string().nullable().optional(), season: z.number().optional(), round: z.string().nullable().optional() }),
  teams: z.object({
    home: z.object({ id: z.number(), name: z.string() }),
    away: z.object({ id: z.number(), name: z.string() }),
  }),
  goals: z.object({ home: z.number().nullable(), away: z.number().nullable() }).optional(),
  score: z.object({
    halftime: z.object({ home: z.number().nullable(), away: z.number().nullable() }).optional(),
    fulltime: z.object({ home: z.number().nullable(), away: z.number().nullable() }).optional(),
  }).optional(),
});

/** A price in the pre-match shape: the line is inside `value` ("Over 2.5"). */
export const prematchValue = z.object({ value: z.union([z.string(), z.number()]), odd: z.union([z.string(), z.number()]) });
export const prematchBet = z.object({ id: z.number(), name: z.string(), values: z.array(prematchValue) });
export const prematchBookmaker = z.object({ id: z.number(), name: z.string(), bets: z.array(prematchBet) });
export const prematchOddsEntry = z.object({
  league: z.object({ id: z.number(), name: z.string().optional(), season: z.number().optional() }).optional(),
  fixture: z.object({ id: z.number(), date: z.string().optional(), timestamp: z.number().optional() }),
  update: z.string().optional(),
  bookmakers: z.array(prematchBookmaker),
});

/**
 * A price in the live shape. Three fields exist only here: `handicap` holds the
 * line that pre-match embeds in `value`, `main` marks the headline line, and
 * `suspended` is the per-selection flag §8 depends on.
 */
export const liveValue = z.object({
  value: z.union([z.string(), z.number()]),
  odd: z.union([z.string(), z.number()]),
  handicap: z.string().nullable().optional(),
  main: z.boolean().nullable().optional(),
  suspended: z.boolean().nullable().optional(),
});
export const liveOddsEntry = z.object({
  fixture: z.object({
    id: z.number(),
    status: z.object({ long: z.string(), elapsed: z.number().nullable().optional(), seconds: z.string().nullable().optional() }),
  }),
  league: z.object({ id: z.number(), season: z.number().optional() }).optional(),
  teams: z.object({
    home: z.object({ id: z.number(), goals: z.number().nullable().optional() }),
    away: z.object({ id: z.number(), goals: z.number().nullable().optional() }),
  }).optional(),
  /** Market-wide suspension for the whole fixture (§8). */
  status: z.object({ stopped: z.boolean(), blocked: z.boolean(), finished: z.boolean() }),
  update: z.string().optional(),
  odds: z.array(z.object({ id: z.number(), name: z.string(), values: z.array(liveValue) })),
});

/** `/odds/bookmakers`, `/odds/bets`, `/odds/live/bets` all share this shape. */
export const referenceEntry = z.object({ id: z.number(), name: z.string() });

export type FixtureEntry = z.infer<typeof fixtureEntry>;
export type PrematchOddsEntry = z.infer<typeof prematchOddsEntry>;
export type LiveOddsEntry = z.infer<typeof liveOddsEntry>;
export type ReferenceEntry = z.infer<typeof referenceEntry>;
export type LeagueEntry = z.infer<typeof leagueEntry>;

/**
 * API-Football's fixture status short codes. Only the ones we branch on are
 * named; anything else is treated as not-yet-started, which is the safe default
 * because it keeps a market bettable only while we are sure it has not begun.
 */
export const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);
export const CANCELLED_STATUSES = new Set(['CANC', 'ABD', 'AWD', 'WO']);
export const POSTPONED_STATUSES = new Set(['PST', 'SUSP', 'INT']);
export const IN_PLAY_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE']);
