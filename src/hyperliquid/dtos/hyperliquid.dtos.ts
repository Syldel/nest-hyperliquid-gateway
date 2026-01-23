import {
  IsBoolean,
  IsNumber,
  IsString,
  IsArray,
  ValidateNested,
  IsOptional,
  IsIn,
  IsHexadecimal,
  Length,
} from 'class-validator';
import { Type } from 'class-transformer';

import type { HLOrderGrouping } from '@syldel/hl-shared-types';
import { HLOrderDetailsDto } from './hyperliquid-order-details.dtos';

export class PlaceOrderDto {
  @ValidateNested()
  @Type(() => HLOrderDetailsDto)
  order: HLOrderDetailsDto;

  @IsOptional()
  @IsIn(['na', 'normalTpsl', 'positionTpsl'])
  grouping?: HLOrderGrouping;

  @IsOptional()
  builder?: { b: string; f: number };

  @IsBoolean()
  @IsOptional()
  isTestnet: boolean = false;
}

export class CancelOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Object)
  cancels: Array<{ asset: number; oid: number }>;

  @IsBoolean()
  @IsOptional()
  isTestnet: boolean = false;
}

export class CancelByCloidItemDto {
  @IsNumber()
  asset: number;

  @IsString()
  @IsHexadecimal()
  @Length(32, 32, {
    message: 'cloid must be a 32-character hex string (16 bytes)',
  })
  cloid: string;
}

export class CancelOrderByCloidDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CancelByCloidItemDto)
  cancels: CancelByCloidItemDto[];

  @IsBoolean()
  @IsOptional()
  isTestnet?: boolean = false;
}

export class UpdateLeverageDto {
  @IsNumber()
  asset: number;

  @IsBoolean()
  isCross: boolean;

  @IsNumber()
  leverage: number;

  @IsBoolean()
  @IsOptional()
  isTestnet: boolean = false;
}

// export class WithdrawToArbitrumDto {
//   @IsString()
//   destination: string;

//   @IsString()
//   amount: string;

//   @IsBoolean()
//   @IsOptional()
//   isTestnet: boolean = false;
// }

export class TransferSpotPerpDto {
  @IsString()
  amount: string;

  @IsBoolean()
  toPerp: boolean;

  @IsBoolean()
  @IsOptional()
  isTestnet: boolean = false;
}

// export class SendUsdDto {
//   @IsString()
//   destination: string;

//   @IsString()
//   amount: string;

//   @IsBoolean()
//   @IsOptional()
//   isTestnet: boolean = false;
// }
