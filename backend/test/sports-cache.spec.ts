import { RedisService } from '../src/common/redis.service';
import { SportsProvider } from '../src/sports/domain';
import { SportsService } from '../src/sports/sports.service';
import { SportsError } from '../src/sports/provider.errors';
describe('sports Redis cache', () => {
  const redis = new RedisService();
  const provider: jest.Mocked<SportsProvider> = { getSports: jest.fn(), getEvents: jest.fn(), getEventOdds: jest.fn(), getStatus: jest.fn() };
  beforeAll(async () => { await redis.ensureConnected(); }); afterAll(async () => { await redis.onModuleDestroy(); });
  beforeEach(async () => { await redis.client.flushdb(); jest.clearAllMocks(); provider.getSports.mockResolvedValue([{ key: 'soccer_epl', name: 'Football', active: true }]); provider.getEvents.mockResolvedValue([]); });
  it('serves hits without another provider call and separates event keys', async () => { const service = new SportsService(provider, redis); await service.getSports(); await service.getSports(); expect(provider.getSports).toHaveBeenCalledTimes(1); provider.getSports.mockResolvedValue([{ key: 'basketball_nba', name: 'NBA', active: true }]); await redis.client.del('sports:v1:list'); await service.getEvents('basketball_nba'); expect(provider.getEvents).toHaveBeenCalledWith('basketball_nba'); });
  it('coalesces ten simultaneous identical cache misses into one upstream call', async () => { provider.getEvents.mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 10)); return []; }); const service = new SportsService(provider, redis); await Promise.all(Array.from({ length: 10 }, () => service.getEvents('soccer_epl'))); expect(provider.getSports).toHaveBeenCalledTimes(1); expect(provider.getEvents).toHaveBeenCalledTimes(1); });
  it('calls provider after cache expiry and keeps different event IDs separate', async () => { process.env.ODDS_CACHE_TTL_SECONDS = '1'; provider.getEventOdds.mockResolvedValue({} as never); const service = new SportsService(provider, redis); await service.getEventOdds('soccer_epl', 'a'); await service.getEventOdds('soccer_epl', 'b'); expect(provider.getEventOdds).toHaveBeenCalledTimes(2); await new Promise(resolve => setTimeout(resolve, 1100)); await service.getEventOdds('soccer_epl', 'a'); expect(provider.getEventOdds).toHaveBeenCalledTimes(3); delete process.env.ODDS_CACHE_TTL_SECONDS; });
  it('rejects unsupported sports before event provider call', async () => { const service = new SportsService(provider, redis); await expect(service.getEvents('invented')).rejects.toBeInstanceOf(SportsError); expect(provider.getEvents).not.toHaveBeenCalled(); });
});
