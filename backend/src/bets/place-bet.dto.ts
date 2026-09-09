import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDecimal, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';
import { BetType } from '@prisma/client';
export class BetSelectionDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,150}$/) eventId!: string;
  @IsString() @Matches(/^[a-z0-9_:-]{1,100}$/) sportKey!: string;
  @IsString() @Matches(/^[a-z0-9_:-]{1,100}$/) marketKey!: string;
  @IsString() selectionKey!: string;
  @IsOptional() @IsDecimal({ decimal_digits: '0,8', force_decimal: false }) displayedOdds?: string;
}
export class PlaceBetDto {
  @IsEnum(BetType) type!: BetType;
  @IsInt() @Min(1) @Max(1_000_000_000) stake!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => BetSelectionDto) selections!: BetSelectionDto[];
  @IsUUID() idempotencyKey!: string;
}
