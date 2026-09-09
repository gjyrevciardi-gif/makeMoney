import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

/**
 * The only fields a browser may submit for a dice round.
 *
 * `forbidNonWhitelisted` is enabled globally, so a request carrying `result`,
 * `multiplier`, `payout`, `won`, `balance`, `userId`, or `role` is rejected
 * outright rather than silently ignored.
 */
export class PlayDiceDto {
  @IsInt() @Min(1) @Max(1_000_000_000) stake!: number;

  @IsIn(['ROLL_UNDER', 'ROLL_OVER']) mode!: 'ROLL_UNDER' | 'ROLL_OVER';

  /**
   * Target on the integer scale [0, 9999], displayed as 0.00 - 99.99.
   * Sent as an integer so no payout decision depends on float parsing.
   */
  @IsInt() @Min(0) @Max(9_999) target!: number;

  @IsUUID() idempotencyKey!: string;

  /** Optional player fairness input; influences the byte stream, never authority. */
  @IsOptional() @IsString() @Matches(/^[\w .:-]{1,128}$/) clientSeed?: string;
}
