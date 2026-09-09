import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

/**
 * Slot spin contract.
 *
 * The only things a browser may choose are the stake and an optional fairness
 * client seed. Reel stops, the matrix, winning lines, multipliers, payouts and
 * the game version are all server decisions, and global whitelist validation
 * rejects the entire request if any of them are supplied.
 */
export class SpinSlotDto {
  @IsInt() @Min(1) @Max(1_000_000_000) stake!: number;

  @IsUUID() idempotencyKey!: string;

  @IsOptional() @IsString() @Matches(/^[\w .:-]{1,128}$/) clientSeed?: string;
}
