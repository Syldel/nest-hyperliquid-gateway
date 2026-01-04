import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsNumberString,
} from 'class-validator';
import { Transform } from 'class-transformer';

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
