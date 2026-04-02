import { Injectable } from '@nestjs/common';

import { DecimalString } from '@syldel/hl-shared-types';

@Injectable()
export class PriceMathService {
  /**
   * Calcule le tick minimum (ex: 0.001) basé sur le prix ou un nombre de décimales fixé.
   */
  inferTickFromPrice(price: DecimalString, decimals?: number): DecimalString {
    const d = decimals !== undefined ? decimals : this.countDecimals(price);
    if (d <= 0) return '1';
    return `0.${'0'.repeat(d - 1)}1`;
  }

  /**
   * Version principale avec paramètre decimals optionnel
   */
  getOneTickAroundPrice(price: string, decimals?: number) {
    const targetDecimals =
      decimals !== undefined ? decimals : this.countDecimals(price);
    const tick = this.inferTickFromPrice(price, targetDecimals);
    const result = this.getOneTickAround(price, tick, targetDecimals);

    return {
      tick,
      ...result,
    };
  }

  getOneTickAround(
    price: string,
    tick: string,
    decimals?: number,
  ): {
    below: string;
    above: string;
  } {
    // Si decimals n'est pas fourni, on prend le max de décimales entre price et tick
    const finalDecimals =
      decimals !== undefined
        ? decimals
        : Math.max(this.countDecimals(price), this.countDecimals(tick));

    const factor = Math.pow(10, finalDecimals);

    const priceInt = Math.round(Number(price) * factor);
    const tickInt = Math.round(Number(tick) * factor);

    const below = (priceInt - tickInt) / factor;
    const above = (priceInt + tickInt) / factor;

    return {
      below: this.normalizeDecimalString(below.toFixed(finalDecimals)),
      above: this.normalizeDecimalString(above.toFixed(finalDecimals)),
    };
  }

  private countDecimals(value: string): number {
    const dot = value.indexOf('.');
    return dot === -1 ? 0 : value.length - dot - 1;
  }

  private normalizeDecimalString(value: string): string {
    if (value.startsWith('.')) return `0${value}`;
    if (value.startsWith('-.')) return value.replace('-.', '-0.');

    // Supprime les zéros inutiles à la fin si c'est un entier (ex: "99.00" -> "99")
    if (value.includes('.')) {
      const normalized = value.replace(/\.?0+$/, '');
      return normalized === '' ? '0' : normalized;
    }
    return value;
  }
}
