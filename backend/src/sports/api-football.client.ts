import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { apiFootballConfig } from './api-football.config';
import { SportsError } from './provider.errors';

/**
 * Transport for API-Football (API-Sports).
 *
 * Everything here is fixed by the provider's published contract rather than
 * inferred: the base host `https://v3.football.api-sports.io`, the single
 * `x-apisports-key` request header, and an envelope of
 * `{ get, parameters, errors, results, paging, response }` on every route.
 * Response *contents* are deliberately not modelled here — those schemas come
 * from the discovery spike (§3) so normalization is written against observed
 * payloads instead of guesses.
 *
 * The key travels as a header and never as a query parameter, so it cannot leak
 * through a URL in a log line, an error message or a stack trace (§2).
 */

/** The envelope every API-Football route returns, whatever the payload. */
export const apiFootballEnvelope = z.object({
  get: z.string().optional(),
  parameters: z.unknown().optional(),
  // `errors` is an array when empty and an object of field->message when not.
  errors: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
  results: z.number().optional(),
  paging: z.object({ current: z.number(), total: z.number() }).optional(),
  response: z.array(z.unknown()).optional(),
});
export type ApiFootballEnvelope = z.infer<typeof apiFootballEnvelope>;

/** Per-account quota, read from the response headers for diagnostics (§12). */
export type ApiFootballQuota = { limitDay?: number; remainingDay?: number; limitMinute?: number; remainingMinute?: number };

const numberOrUndefined = (value: string | null) => (value === null || value.trim() === '' ? undefined : Number(value));

/** API-Football reports its own faults in a 200 body, so status alone is not enough. */
export const envelopeErrors = (body: ApiFootballEnvelope): string[] => {
  const errors = body.errors;
  if (!errors) return [];
  if (Array.isArray(errors)) return errors.map(String);
  return Object.entries(errors).map(([field, message]) => `${field}: ${String(message)}`);
};

function classifyHttpStatus(status: number): string {
  if (status === 401 || status === 403) return 'SPORTS_PROVIDER_UNAUTHORIZED';
  if (status === 429) return 'SPORTS_PROVIDER_RATE_LIMITED';
  if (status === 499) return 'SPORTS_PROVIDER_TIMEOUT';
  return 'SPORTS_PROVIDER_UNAVAILABLE';
}

export type ApiFootballResponse = { body: ApiFootballEnvelope; quota: ApiFootballQuota };

export class ApiFootballClient {
  private readonly logger = new Logger(ApiFootballClient.name);
  private readonly config = apiFootballConfig();

  get configured() { return this.config.enabled && Boolean(this.config.apiKey); }

  /**
   * One GET against the provider. `path` is a route plus query string, e.g.
   * `/fixtures?league=39&next=5`. Callers own caching; this makes a real call
   * every time it is invoked, which is why nothing calls it per component (§9).
   */
  async get(path: string): Promise<ApiFootballResponse> {
    if (!this.configured) throw new SportsError('SPORTS_PROVIDER_NOT_CONFIGURED', 503, 'Soccer provider is not configured.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        signal: controller.signal,
        headers: { accept: 'application/json', 'x-apisports-key': this.config.apiKey! },
      });
      const quota: ApiFootballQuota = {
        limitDay: numberOrUndefined(response.headers.get('x-ratelimit-requests-limit')),
        remainingDay: numberOrUndefined(response.headers.get('x-ratelimit-requests-remaining')),
        limitMinute: numberOrUndefined(response.headers.get('X-RateLimit-Limit')),
        remainingMinute: numberOrUndefined(response.headers.get('X-RateLimit-Remaining')),
      };
      if (!response.ok) throw new SportsError(classifyHttpStatus(response.status), 503, undefined, response.status);
      const parsed = apiFootballEnvelope.safeParse(await response.json());
      if (!parsed.success) throw new SportsError('SPORTS_PROVIDER_INVALID_RESPONSE', 503, undefined, response.status);
      const errors = envelopeErrors(parsed.data);
      if (errors.length) {
        // A spent quota or a rejected key arrives as HTTP 200 with a populated
        // `errors` object; treating that as success would cache an empty board.
        const rateLimited = errors.some(message => /limit|quota/i.test(message));
        this.logger.warn({ event: 'API_FOOTBALL_ENVELOPE_ERROR', path: path.split('?')[0], errors });
        throw new SportsError(rateLimited ? 'SPORTS_PROVIDER_RATE_LIMITED' : 'SPORTS_PROVIDER_UNAVAILABLE', 503, undefined, response.status);
      }
      // Only the route is logged, never the query string: some routes carry ids
      // that are fine, but the key must never reach a log line by any path (§2).
      this.logger.log({ event: 'API_FOOTBALL_REQUEST_SUCCESS', path: path.split('?')[0], results: parsed.data.results });
      return { body: parsed.data, quota };
    } catch (error) {
      if (error instanceof SportsError) throw error;
      const aborted = controller.signal.aborted;
      throw new SportsError(aborted ? 'SPORTS_PROVIDER_TIMEOUT' : 'SPORTS_PROVIDER_UNAVAILABLE', 503);
    } finally {
      clearTimeout(timer);
    }
  }
}
