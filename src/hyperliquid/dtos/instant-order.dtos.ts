import {
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
  IsNumber,
  IsIn,
  ValidateIf,
  IsDefined,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class OrderSizeDto {
  @IsIn(['base', 'quote', 'percent'])
  type: 'base' | 'quote' | 'percent';

  @ValidateIf((o: OrderSizeDto) => o.type === 'base')
  @IsString()
  sz?: string;

  @ValidateIf((o: OrderSizeDto) => o.type === 'quote')
  @IsString()
  usdc?: string;

  @ValidateIf((o: OrderSizeDto) => o.type === 'percent')
  @IsString()
  percent?: string;
}

export class InstantOrderDto {
  @IsString()
  assetName: string;

  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isBuy: boolean;

  @IsDefined({ message: 'size is required' })
  @ValidateNested()
  @Type(() => OrderSizeDto)
  size: OrderSizeDto;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isTestnet?: boolean;

  @IsOptional()
  @IsNumber()
  maxRetries?: number;

  @IsOptional()
  @IsNumber()
  delayMs?: number;
}
