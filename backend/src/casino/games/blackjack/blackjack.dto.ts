import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

/**
 * Blackjack request contracts. The client may commit a stake and choose an
 * action; it can never submit cards, a shoe, a dealer hand, an outcome, or a
 * payout, and whitelist validation rejects any request that tries.
 */
export class StartBlackjackDto {
  @IsInt() @Min(1) @Max(1_000_000_000) stake!: number;

  @IsUUID() idempotencyKey!: string;

  @IsOptional() @IsString() @Matches(/^[\w .:-]{1,128}$/) clientSeed?: string;
}

export class BlackjackActionDto {
  @IsUUID() idempotencyKey!: string;
}
