import {
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
  IsInt,
  IsIn,
  Max,
  Min,
  ValidateIf,
  IsDefined,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import type { HLTif } from '@syldel/hl-shared-types';

/**
 * Les bornes d'un ordre instantané (`SmartOrderService.instantOrder`), et leurs raisons.
 *
 * - **6 tentatives au plus** : la valeur par défaut, la seule que le bot ait jamais employée (il n'envoie pas ce champ).
 * - **1 s d'écart au moins** : chaque tentative est une lecture du marché (poids 20) et un ordre ; sans attente, six
 *   tentatives partiraient dans la même seconde.
 * - **15 s d'écart au plus** : le bot abandonne une écriture au bout de `WRITE_TIMEOUT_MS` (180 s,
 *   `nest-trading-bot/src/hyperliquid/services/hyperliquid-api.service.ts`) et la déclare en état inconnu. Le pire cas
 *   est 6 attentes plus 45 s de suivi du statut : 6 × 15 + 45 = 135 s, sous ce délai. 30 s l'aurait dépassé (225 s).
 */
export const INSTANT_ORDER_LIMITS = {
  maxRetries: 6,
  defaultDelayMs: 7_500,
  minDelayMs: 1_000,
  maxDelayMs: 15_000,
} as const;

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
  @IsIn(['Gtc', 'Ioc', 'Alo'])
  tif?: HLTif;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  reduceOnly?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isTestnet?: boolean;

  /**
   * Bornés depuis le 2026-11-09. Avant, `@IsNumber()` seul laissait un client demander un million de tentatives sans
   * attente : `instantOrder` relance sur un refus post-only, fréquent pour un ALO au prix marqué, et le garde de débit ne
   * freine jamais les ordres. Seule la lecture du marché faite à chaque tentative l'arrêtait, au plafond local des
   * lectures : environ 45 ordres partis d'un coup. Voir `INSTANT_ORDER_LIMITS`.
   *
   * `ValidateIf` et non `IsOptional` : ce dernier laisse passer `null`, que la valeur par défaut du service ne remplace
   * pas (elle ne vaut que pour `undefined`). `delayMs: null` aurait fait `sleep(null)`, donc aucune attente.
   */
  @ValidateIf((o: InstantOrderDto) => o.maxRetries !== undefined)
  @IsInt()
  @Min(1)
  @Max(INSTANT_ORDER_LIMITS.maxRetries)
  maxRetries?: number;

  @ValidateIf((o: InstantOrderDto) => o.delayMs !== undefined)
  @IsInt()
  @Min(INSTANT_ORDER_LIMITS.minDelayMs)
  @Max(INSTANT_ORDER_LIMITS.maxDelayMs)
  delayMs?: number;
}
