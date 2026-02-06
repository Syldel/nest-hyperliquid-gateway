import {
  IsString,
  IsOptional,
  IsEnum,
  IsNotEmpty,
  IsNumber,
} from 'class-validator';
import type {
  CandleInterval,
  HexString,
  Timestamp,
} from '@syldel/hl-shared-types';
import { Type } from 'class-transformer';

export class GetCandlesQueryDto {
  @IsString()
  @IsNotEmpty()
  coin: string;

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
  interval: CandleInterval;

  @IsNumber()
  @IsNotEmpty()
  @Type(() => Number)
  startTime: Timestamp;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  endTime?: Timestamp;
}

export class GetUserPortfolioQueryDto {
  @IsString()
  @IsNotEmpty()
  user: HexString;
}
