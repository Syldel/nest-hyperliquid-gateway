import {
  IsBoolean,
  IsNumber,
  IsString,
  IsArray,
  ValidateNested,
  IsOptional,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { HLOrderDetails } from '../interfaces/orders/order-details.interfaces';
import type { HLOrderGrouping } from '../interfaces/actions/order.interfaces';

export class PlaceOrderDto {
  @ValidateNested()
  @Type(() => Object)
  order: HLOrderDetails;

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
