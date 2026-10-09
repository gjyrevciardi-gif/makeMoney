import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { LUCKY_LADY_PAYOUT_STYLES } from './lucky-lady-payout.types';

/**
 * Transport whitelist for the admin RTP Control panel.
 *
 * Only policy-shaped fields are accepted: a target return, the bounded max-win
 * multiplier, and a style. Every other field is rejected by the global
 * `forbidNonWhitelisted` pipe, so no player, session, balance, history, seed or
 * client-supplied report/evidence value can ever reach the service.
 */
export class PayoutGenerateDto {
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) @Max(100)
  targetRtpPercent?: number;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) @Max(100)
  targetRtp?: number;

  @Type(() => Number) @IsInt() @IsIn([20, 50])
  maxWinMultiplier!: number;

  @IsOptional() @IsString() @IsIn([...LUCKY_LADY_PAYOUT_STYLES])
  style?: string;

  /** Accepted generator constraints; the service re-whitelists every key. */
  @IsOptional() @IsObject()
  constraints?: Record<string, unknown>;
}

export class PayoutActionDto {
  @IsString() @MinLength(8) @MaxLength(120)
  actionId!: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  expectedVersion?: number;
}

export class PayoutCandidateParams {
  @IsString() @MaxLength(160)
  candidateId!: string;
}
