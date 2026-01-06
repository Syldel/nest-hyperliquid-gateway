import {
  IsBoolean,
  IsOptional,
  IsString,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { DecimalString } from '../interfaces';

@ValidatorConstraint({ name: 'OrderTypeXor', async: false })
export class OrderTypeXorValidator implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;

    const v = value as {
      limit?: unknown;
      trigger?: unknown;
    };

    const hasLimit = v.limit !== undefined;
    const hasTrigger = v.trigger !== undefined;

    return hasLimit !== hasTrigger;
  }

  defaultMessage(): string {
    return 'orderType must contain either limit or trigger (but not both)';
  }
}

export class HLOrderTypeLimitDto {
  @IsString()
  tif: 'Alo' | 'Ioc' | 'Gtc';
}

export class HLOrderTypeTriggerDto {
  @IsBoolean()
  isMarket: boolean;

  @IsString()
  triggerPx: DecimalString;

  @IsString()
  tpsl: 'tp' | 'sl';
}

export class HLOrderTypeDto {
  /**
   * Limit order configuration
   * (Alo, Ioc, Gtc)
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => HLOrderTypeLimitDto)
  limit?: HLOrderTypeLimitDto;

  /**
   * Trigger order configuration (TP / SL)
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => HLOrderTypeTriggerDto)
  trigger?: HLOrderTypeTriggerDto;
}

export class HLOrderDetailsDto {
  @IsString()
  assetName: string;

  @IsBoolean()
  isBuy: boolean;

  @IsString()
  limitPx: DecimalString;

  @IsString()
  sz: DecimalString;

  @IsBoolean()
  reduceOnly: boolean;

  @Validate(OrderTypeXorValidator)
  @ValidateNested()
  @Type(() => HLOrderTypeDto)
  orderType: HLOrderTypeDto;

  @IsOptional()
  @IsString()
  cloid?: string;
}
