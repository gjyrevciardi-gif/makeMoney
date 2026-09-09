export type NormalizedEventResult = { provider: string; providerEventId: string; status: 'FINAL' | 'CANCELLED' | 'POSTPONED' | 'UNKNOWN'; homeScore?: number; awayScore?: number; completedAt?: Date; metadata?: Record<string, unknown> };
export interface SportsResultProvider { getEventResult(sportKey: string, eventId: string, homeTeam: string, awayTeam: string): Promise<NormalizedEventResult | null>; }
export const SPORTS_RESULT_PROVIDER = Symbol('SPORTS_RESULT_PROVIDER');
