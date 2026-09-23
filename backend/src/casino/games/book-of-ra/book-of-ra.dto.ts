import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export const BOOK_OF_RA_GAMBLE_CHOICES = ['red', 'black', 'collect'] as const;
export type BookOfRaGambleChoiceDto = (typeof BOOK_OF_RA_GAMBLE_CHOICES)[number];

/**
 * Book of the Sands spin contract.
 *
 * The only things a browser may choose are the bet per line, an optional
 * fairness client seed, and whether the spin is part of an autoplay run. The
 * board, the expanding symbol, the free-spin counters, the gamble colours and
 * the payout are all server decisions, and global whitelist validation rejects
 * the whole request if any of them are supplied.
 */
export class SpinBookOfRaDto {
  /**
   * Stake for one line. The server multiplies it by the ten lines it locks for
   * the whole session, so a client can never change the number of lines.
   */
  @IsInt() @Min(1) @Max(100_000_000) betPerLine!: number;

  @IsUUID() idempotencyKey!: string;

  @IsOptional() @IsString() @Matches(/^[\w .:-]{1,128}$/) clientSeed?: string;

  /** Autoplay never offers the gamble; the server decides, the flag only declares intent. */
  @IsOptional() @IsBoolean() autoplay?: boolean;
}

/** Resolves the single pending server action of one round. */
export class BookOfRaActionDto {
  @IsUUID() roundId!: string;
  @IsString() @MinLength(8) @MaxLength(160) actionId!: string;
  @IsIn(BOOK_OF_RA_GAMBLE_CHOICES) choiceId!: BookOfRaGambleChoiceDto;
  @IsUUID() idempotencyKey!: string;
}
