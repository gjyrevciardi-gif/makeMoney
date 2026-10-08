import { Allow, IsIn, IsString, Length } from 'class-validator';

export const CLASSIC_PLAY_EVENTS = [
  'getSettings',
  'update',
  'bet',
  'freespin',
  'slotGamble',
  'recoveryGamble',
  'recoveryCollect',
  'ack',
] as const;

/**
 * One-time launch capability exchange.
 *
 * The gateway posts the opaque token it received from the authenticated
 * launcher; the platform never accepts a user id, a role or a session from the
 * body.
 */
export class ExchangeLaunchDto {
  @IsString()
  @Length(16, 200)
  token!: string;
}

/**
 * The recovered client's own protocol body.
 *
 * Only these fields may appear; the global validation pipe rejects anything
 * else, and every value is re-validated against the locked round inside the
 * service. `slotEvent` is constrained to the exact supported set.
 */
export class ClassicPlayDto {
  @IsIn(CLASSIC_PLAY_EVENTS)
  slotEvent!: (typeof CLASSIC_PLAY_EVENTS)[number];

  @Allow()
  slotBet?: unknown;

  @Allow()
  slotLines?: unknown;

  @Allow()
  gambleChoice?: unknown;

  @Allow()
  actionId?: unknown;
}
