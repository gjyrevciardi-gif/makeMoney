import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

/**
 * Tumbling slot spin contract.
 *
 * The only things a browser may choose are the bet, whether it is buying the
 * feature, and an optional fairness client seed. The board, every tumble, every
 * orb face, the free spins, the multiplier, the payout and the game version are
 * all server decisions, and global whitelist validation rejects the entire
 * request if any of them are supplied.
 *
 * `stake` is ONE BET, never the amount charged: buying the feature multiplies it
 * by the published price, and the wallet is debited with the result.
 */
export class SpinTumbleDto {
  @IsInt() @Min(1) @Max(1_000_000_000) stake!: number;

  @IsUUID() idempotencyKey!: string;

  @IsOptional() @IsIn(['BASE', 'BUY_FEATURE']) mode?: 'BASE' | 'BUY_FEATURE';

  @IsOptional() @IsString() @Matches(/^[\w .:-]{1,128}$/) clientSeed?: string;
}
