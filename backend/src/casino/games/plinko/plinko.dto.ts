import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';
import { PLINKO_RISKS, PLINKO_ROWS, PlinkoRisk } from './plinko.engine';

/**
 * Plinko request contract.
 *
 * Only the stake and the board shape are the client's to choose. The path, the
 * bucket, the multiplier and the payout are all server decisions, and global
 * whitelist validation rejects a request that tries to supply them.
 */
export class PlayPlinkoDto {
  @IsInt() @Min(1) @Max(1_000_000_000) stake!: number;

  @IsIn([...PLINKO_ROWS]) rows!: number;

  @IsIn(PLINKO_RISKS) risk!: PlinkoRisk;

  @IsUUID() idempotencyKey!: string;

  @IsOptional() @IsString() @Matches(/^[\w .:-]{1,128}$/) clientSeed?: string;
}
