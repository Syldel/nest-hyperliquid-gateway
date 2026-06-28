import {
  IsString,
  IsOptional,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsIn,
  ValidateIf,
} from 'class-validator';
import type {
  CandleInterval,
  HexString,
  HLMantissaOptions,
  HLNSigFigsOptions,
  Timestamp,
} from '@syldel/hl-shared-types';
import { Transform, Type } from 'class-transformer';

export class GetCandlesQueryDto {
  @IsString()
  @IsNotEmpty()
  coin!: string;

  @IsEnum([
    '1m',
    '3m',
    '5m',
    '15m',
    '30m',
    '1h',
    '2h',
    '4h',
    '8h',
    '12h',
    '1d',
    '3d',
    '1w',
    '1M',
  ])
  interval!: CandleInterval;

  @IsNumber()
  @IsNotEmpty()
  @Type(() => Number)
  startTime!: Timestamp;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  endTime?: Timestamp;
}

export class GetL2BookQueryDto {
  @IsString()
  coin!: string;

  @IsOptional()
  @Transform(({ value }) => (value === 'null' ? null : Number(value)))
  @IsIn([2, 3, 4, 5, null], {
    message: 'nSigFigs must be 2, 3, 4, 5 or null',
  })
  nSigFigs?: HLNSigFigsOptions;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsIn([1, 2, 5], { message: 'mantissa must be 1, 2 or 5' })
  @ValidateIf((o: GetL2BookQueryDto) => o.nSigFigs === 5, {
    message: 'mantissa is only allowed if nSigFigs is 5',
  })
  mantissa?: HLMantissaOptions;
}

export class GetUserPortfolioQueryDto {
  @IsString()
  @IsOptional()
  user?: HexString;
}

export class GetActiveAssetDataQueryDto {
  @IsNotEmpty()
  @IsString()
  coin!: string;
}
