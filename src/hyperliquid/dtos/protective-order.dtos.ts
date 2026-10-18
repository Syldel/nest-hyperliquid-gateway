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

  /** Côté de l'ORDRE (clôture) : false => vente, qui ferme un long. */
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
   * Côté de l'ORDRE, donc de la clôture — pas celui de la position :
   * true  => achat (ferme un short)
   * false => vente (ferme un long)
   *
   * C'est ce que le bot envoie (`isBuy = !isLongEntry`), et de lui dépend le sens du prix
   * limite d'un déclencheur au marché. Ce commentaire disait « Position side » : faux.
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
