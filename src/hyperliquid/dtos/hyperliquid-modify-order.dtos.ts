import { IsArray, IsNumber, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import { HLOrderDetailsDto } from './hyperliquid-order-details.dtos';

/**
 * DTO pour modifier un ordre unique
 */
export class ModifyOrderDto {
  @IsNumber()
  oid: number;

  @ValidateNested()
  @Type(() => HLOrderDetailsDto)
  order: HLOrderDetailsDto;

  @IsOptional()
  isTestnet?: boolean;
}

/**
 * DTO pour modifier plusieurs ordres en batch
 */
class SingleModify {
  @IsNumber()
  oid: number;

  @ValidateNested()
  @Type(() => HLOrderDetailsDto)
  order: HLOrderDetailsDto;
}

export class BatchModifyOrdersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SingleModify)
  modifies: SingleModify[];

  @IsOptional()
  isTestnet?: boolean;
}
