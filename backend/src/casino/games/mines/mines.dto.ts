import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

/**
 * Mines request contracts. Global `forbidNonWhitelisted` validation rejects any
 * attempt to submit `safe`, `mines` positions, `multiplier`, `payout`,
 * `status`, `userId`, or `balance`.
 */
export class StartMinesDto {
  @IsInt() @Min(1) @Max(1_000_000_000) stake!: number;

  /** Number of hidden bombs on the 25-cell board. */
  @IsInt() @Min(1) @Max(24) mines!: number;

  @IsUUID() idempotencyKey!: string;

  @IsOptional() @IsString() @Matches(/^[\w .:-]{1,128}$/) clientSeed?: string;
}

export class RevealMinesDto {
  /** Board index on [0, 24]. Whether it is safe is decided by the server alone. */
  @IsInt() @Min(0) @Max(24) cell!: number;

  @IsUUID() idempotencyKey!: string;
}

export class CashoutMinesDto {
  @IsUUID() idempotencyKey!: string;
}
