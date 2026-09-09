import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { sportsConfig } from '../sports/sports.config';
import { SportsError } from '../sports/provider.errors';
import { NormalizedEventResult, SportsResultProvider } from './result-provider';
import { OperationsHealthService } from '../operations/operations-health.service';
const scoreEvent = z.object({ id: z.string(), completed: z.boolean(), commence_time: z.string().optional(), scores: z.array(z.object({ name: z.string(), score: z.string().regex(/^\d+$/) })).nullable() });
@Injectable()
export class TheOddsApiResultProvider implements SportsResultProvider {
  private readonly config = sportsConfig();
  constructor(private readonly health: OperationsHealthService) {}
  async getEventResult(sportKey: string, eventId: string, homeTeam: string, awayTeam: string): Promise<NormalizedEventResult | null> {
    if (!this.config.apiKey) throw new SportsError('SPORTS_RESULT_PROVIDER_UNAVAILABLE', 503, 'Sports result provider is not configured.');
    const url = new URL(`${this.config.baseUrl}/sports/${encodeURIComponent(sportKey)}/scores`); url.searchParams.set('apiKey', this.config.apiKey); url.searchParams.set('daysFrom', '3'); url.searchParams.set('eventIds', eventId);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
      const remainingHeader = response.headers.get('x-requests-remaining'), usedHeader = response.headers.get('x-requests-used');
      if (!response.ok) { const code = response.status === 429 ? 'SPORTS_PROVIDER_RATE_LIMITED' : 'SPORTS_RESULT_PROVIDER_UNAVAILABLE'; await this.health.providerFailure(code); throw new SportsError(code, 503); }
      const parsed = z.array(scoreEvent).safeParse(await response.json()); if (!parsed.success) throw new SportsError('SPORTS_RESULT_PROVIDER_UNAVAILABLE', 503);
      await this.health.providerSuccess({ remaining: remainingHeader === null ? undefined : Number(remainingHeader), used: usedHeader === null ? undefined : Number(usedHeader) });
      const event = parsed.data.find(item => item.id === eventId); if (!event) return null;
      if (!event.completed || !event.scores) return { provider: 'the-odds-api', providerEventId: eventId, status: 'UNKNOWN' };
      const home = event.scores.find(score => score.name === homeTeam), away = event.scores.find(score => score.name === awayTeam); if (!home || !away) throw new SportsError('SPORTS_RESULT_PROVIDER_UNAVAILABLE', 503);
      return { provider: 'the-odds-api', providerEventId: eventId, status: 'FINAL', homeScore: Number(home.score), awayScore: Number(away.score), completedAt: new Date() };
    } catch (error) { if (error instanceof SportsError) throw error; await this.health.providerFailure('SPORTS_RESULT_PROVIDER_UNAVAILABLE'); throw new SportsError('SPORTS_RESULT_PROVIDER_UNAVAILABLE', 503); } finally { clearTimeout(timer); }
  }
}
