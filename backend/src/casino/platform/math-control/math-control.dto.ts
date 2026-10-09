import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  MAX_WIN_SCOPES,
  PACING_MODES,
  RETURN_TIERS,
} from './math-control.types';

/**
 * Generation request, transport layer.
 *
 * This shape is a whitelist: the global validation pipe rejects the whole
 * request if it carries any field that is not declared here. There is
 * deliberately no `gameId`, `userId`, `actorId`, `role`, `sessionId`,
 * `balance`, `history`, `seed` or `roundId`: generation input is policy and
 * game maths only.
 */

class CustomPacingDto {
  @IsInt() @Min(0) @Max(1_000_000) zeroWeight!: number;
  @IsInt() @Min(0) @Max(1_000_000) partialWeight!: number;
  @IsInt() @Min(0) @Max(1_000_000) breakEvenWeight!: number;
  @IsInt() @Min(0) @Max(1_000_000) winWeight!: number;
}

class HitRateDto {
  @IsIn(['AUTO', 'EXPLICIT', 'RANGE']) mode!: 'AUTO' | 'EXPLICIT' | 'RANGE';
  @IsOptional() @IsNumber() @Min(0) @Max(1) target?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) min?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) max?: number;
}

class FeatureContributionDto {
  @IsNumber() @Min(0) @Max(100) minPercent!: number;
  @IsNumber() @Min(0) @Max(100) maxPercent!: number;
}

export class MathPolicyDto {
  @IsNumber() @Min(0) @Max(100) targetRtpPercent!: number;
  @IsNumber() @Min(1) @Max(1_000_000_000) maxWinMultiplier!: number;
  @IsIn(MAX_WIN_SCOPES as unknown as string[]) maxWinScope!: string;
  @IsIn(PACING_MODES as unknown as string[]) pacing!: string;
  @IsOptional() @ValidateNested() @Type(() => CustomPacingDto) customPacing?: CustomPacingDto;
  @ValidateNested() @Type(() => HitRateDto) hitRate!: HitRateDto;
  @IsIn(RETURN_TIERS as unknown as string[]) partialReturn!: string;
  @IsIn(RETURN_TIERS as unknown as string[]) volatility!: string;
  @IsNumber() @Min(1) @Max(1_000_000_000) bigWinMinMultiplier!: number;
  @IsNumber() @Min(1) @Max(1_000_000_000) bigWinMaxMultiplier!: number;
  @ValidateNested() @Type(() => FeatureContributionDto) featureContribution!: FeatureContributionDto;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(32, { each: true }) presets?: string[];
}

export class ValidationOptionsDto {
  @IsOptional() @IsInt() @Min(1_000) @Max(200_000) monteCarloRounds?: number;
  @IsOptional() @IsInt() @Min(10) @Max(2_000) bankrollSessions?: number;
  @IsOptional() @IsNumber() @Min(0.01) @Max(5) rtpTolerancePercent?: number;
  @IsOptional() @IsInt() @Min(100) @Max(200_000) bankrollHorizonPaidSpins?: number;
}

export class ActivateMathDto {
  /** Optimistic concurrency: the active-pointer version the operator saw. */
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
}
