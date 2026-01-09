import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsNumberString,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export enum HLProtectiveKind {
  TP = 'tp',
  SL = 'sl',
}

export class ProtectiveOrderDto {
  @IsString()
  assetName: string;

  @IsEnum(HLProtectiveKind, {
    message: 'kind must be either "tp" or "sl"',
  })
  kind: HLProtectiveKind;

  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isBuy: boolean;

  @IsNumberString()
  sz: string;

  @IsNumberString()
  price: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isMarket?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isTestnet?: boolean;
}

/* ******************************** BATCH ******************************** */

export class BatchProtectiveOrderItemDto {
  @IsNumberString()
  sz: string;

  @IsNumberString()
  price: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isMarket?: boolean;
}

export class BatchProtectiveOrdersDto {
  /**
   * Asset name (ex: BTC, ETH, SOL)
   */
  @IsString()
  assetName: string;

  /**
   * Position side
   * true  => buy (long)
   * false => sell (short)
   */
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isBuy: boolean;

  /**
   * Take profit orders
   */
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => BatchProtectiveOrderItemDto)
  @ArrayMinSize(1)
  tp?: BatchProtectiveOrderItemDto[];

  /**
   * Stop loss orders
   */
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => BatchProtectiveOrderItemDto)
  @ArrayMinSize(1)
  sl?: BatchProtectiveOrderItemDto[];

  /**
   * Testnet flag
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isTestnet?: boolean;
}
