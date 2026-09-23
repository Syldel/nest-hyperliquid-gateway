import { Injectable } from '@nestjs/common';
import {
  formatPrice,
  formatSize,
  HLMarketType,
  priceDecimals,
} from '@syldel/hl-shared-types';

/**
 * ============================================================================
 * LE DERNIER MOT AVANT L'ENVOI
 *
 * Applique les règles de tick et de lot d'Hyperliquid à tout ordre sortant
 * (`convertToApiOrder`). Un prix ou une taille mal écrits sont refusés par
 * l'exchange, ou acceptés sous une forme tronquée qui n'est plus celle qu'on
 * voulait — sur un stop loss, la différence entre les deux, c'est une position
 * protégée et une position qui ne l'est pas.
 *
 * Les règles elles-mêmes vivent dans `@syldel/hl-shared-types`
 * (`format/tick-and-lot.ts`), et non ici : le bot doit pouvoir savoir **avant
 * d'envoyer** ce que le gateway posera, sans quoi il croit avoir posé autre
 * chose que ce qui l'a été. Une seule implémentation, importée des deux côtés.
 * Ce service n'en est plus que la façade injectable.
 *
 * Voir docs/tick-and-lot-size.md.
 * ============================================================================
 */

export type MarketType = HLMarketType;

@Injectable()
export class ValueFormatterService {
  /**
   * Formate un prix : au plus 5 chiffres significatifs, au plus
   * `MAX_DECIMALS - szDecimals` décimales, un entier étant toujours accepté.
   *
   * @throws {TickAndLotError} si la valeur est illisible, ou tronquée à zéro.
   */
  formatPrice(
    price: string | number,
    szDecimals: number,
    type: MarketType = 'perp',
  ): string {
    return formatPrice(price, szDecimals, type);
  }

  /**
   * Formate une taille : **tronquée** à `szDecimals`, jamais arrondie.
   *
   * @throws {TickAndLotError} si la valeur est illisible, ou tronquée à zéro.
   */
  formatSize(size: string | number, szDecimals: number): string {
    return formatSize(size, szDecimals);
  }

  /**
   * Le nombre de décimales que ce prix a le droit d'avoir — les deux règles
   * réunies en un seul nombre. Exposé pour qu'un appelant puisse poser une
   * valeur déjà sur la grille plutôt que de la faire tronquer derrière lui.
   */
  priceDecimals(
    price: string | number,
    szDecimals: number,
    type: MarketType = 'perp',
  ): number {
    return priceDecimals(price, szDecimals, type);
  }
}
