import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';

import { HLProtectiveKind } from './protective-order.dtos';

/**
 * Un TP/SL « de position » (voir `utils/position-level-order.ts`).
 *
 * **Il n'y a pas de `sz`, et c'est le point.** Le ValidationPipe global refuse une propriété inconnue
 * (`forbidNonWhitelisted`) : un corps qui en porterait une est rejeté en 400 avant toute signature. Ni taille,
 * ni choix entre déclencheur au marché et limite : seule la forme vue (au marché) existe.
 */
export class PositionProtectiveOrderDto {
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

  /** Le prix de déclenchement. */
  @IsNumberString()
  price: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isTestnet?: boolean;
}

/** Modifier un ordre de position existant : son oid, et la même forme. */
export class ModifyPositionProtectiveOrderDto extends PositionProtectiveOrderDto {
  @IsNumber()
  oid: number;
}
