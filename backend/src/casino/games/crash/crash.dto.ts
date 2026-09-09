import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

/**
 * Crash request contracts.
 *
 * The client may commit a stake and, optionally, an auto-cashout target. It can
 * never submit elapsed time, a current multiplier, a cashout multiplier, a
 * crash point, a payout, or a status: global whitelist validation rejects the
 * whole request if any of those appear.
 */
export class StartCrashDto {
  @IsInt() @Min(1) @Max(1_000_000_000) stake!: number;

  /**
   * Optional auto-cashout target in hundredths, e.g. 200 = 2.00x. Sent as an
   * integer so no timing decision depends on parsing a float. The backend owns
   * the trigger: it fires on server time whether or not the browser is open.
   */
  @IsOptional() @IsInt() @Min(101) @Max(1_000_000) autoCashoutCenti?: number;

  @IsUUID() idempotencyKey!: string;

  @IsOptional() @IsString() @Matches(/^[\w .:-]{1,128}$/) clientSeed?: string;
}

export class CashoutCrashDto {
  @IsUUID() idempotencyKey!: string;
}
