import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ROULETTE_BET_TYPES, RouletteBetType } from './roulette.engine';

export class RouletteBetDto {
  @IsIn(ROULETTE_BET_TYPES) type!: RouletteBetType;

  @IsInt() @Min(1) @Max(1_000_000_000) amount!: number;

  /** Required for STRAIGHT; the pocket to back, 0-36. */
  @IsOptional() @IsInt() @Min(0) @Max(36) number?: number;
}

/**
 * A spin request carries only the bets. The winning pocket, the payout, and
 * the multiplier are server decisions, and whitelist validation rejects any
 * attempt to submit them.
 */
export class PlayRouletteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RouletteBetDto)
  bets!: RouletteBetDto[];

  @IsUUID() idempotencyKey!: string;

  @IsOptional() @IsString() @Matches(/^[\w .:-]{1,128}$/) clientSeed?: string;
}
