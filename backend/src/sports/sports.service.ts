import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RedisService } from '../common/redis.service';
import { SPORTS_PROVIDER, SportsBoard, SportsProvider } from './domain';
import { sportsConfig } from './sports.config';
import { SportsError } from './provider.errors';
@Injectable()
export class SportsService {
  private readonly config = sportsConfig();
  constructor(@Inject(SPORTS_PROVIDER) private readonly provider: SportsProvider, private readonly cache: RedisService) {}
  private hash(value: string) { return createHash('sha256').update(value).digest('hex').slice(0, 20); }
  getSports() { return this.cache.cached('sports:v1:list', this.config.ttl.sports, () => this.provider.getSports()); }
  async assertSport(key: string) { if (!(await this.getSports()).some(s => s.key === key)) throw new SportsError('SPORTS_UNSUPPORTED', 400, 'Unsupported sport.'); }
  /**
   * A sport's events together with their primary markets, from one upstream
   * call. This is the listing primitive: `getEvents` is derived from it, so
   * rendering a whole board costs exactly the quota one event list always did.
   */
  async getBoard(sportKey: string): Promise<SportsBoard> {
    await this.assertSport(sportKey);
    return this.cache.cached(`sports:v1:board:${this.hash(sportKey)}`, this.config.ttl.events, async () => {
      if (this.provider.getBoard) return this.provider.getBoard(sportKey);
      // A provider without batched markets still lists its fixtures; the board
      // simply carries no prices rather than fanning out one call per event.
      const events = await this.provider.getEvents(sportKey);
      const fetchedAt = new Date();
      return { sportKey, sportName: events[0]?.sportName ?? sportKey, fetchedAt: fetchedAt.toISOString(), staleAt: new Date(fetchedAt.getTime() + this.config.ttl.odds * 1000).toISOString(), events: events.map(event => ({ event, bookmaker: null, markets: [] })) };
    });
  }
  async getEvents(sportKey: string) { return (await this.getBoard(sportKey)).events.map(row => row.event); }
  async getEventOdds(sportKey: string, eventId: string) { await this.assertSport(sportKey); return this.cache.cached(`sports:v1:odds:${this.hash(`${sportKey}:${eventId}`)}`, this.config.ttl.odds, () => this.provider.getEventOdds(sportKey, eventId)); }
  status() { return this.provider.getStatus(); }
}
