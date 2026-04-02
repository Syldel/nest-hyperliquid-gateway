import { Injectable } from '@nestjs/common';

import { DecimalString } from '@syldel/hl-shared-types';

@Injectable()
export class DecimalUtilsService {
  parse(value: DecimalString, name = 'value'): number {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new Error(`Invalid decimal ${name}: ${value}`);
    }
    return n;
  }

  format(value: number, decimals: number): DecimalString {
    return Number(value.toFixed(decimals)).toString();
  }

  /**
   * Returns value raised to the power of exponent.
   */
  private pow10(decimals: number): bigint {
    return BigInt(10) ** BigInt(decimals);
  }

  /**
   * Converts a decimal string to a BigInt, scaling by the given number of decimals.
   * * It is better to keep parseToBigInt strict, as its role is to ensure that a
   * string is converted to a BigInt integer without any loss of precision.
   */
  private parseToBigInt(
    value: DecimalString,
    decimals: number,
    name: string,
  ): bigint {
    // Basic validation of the decimal string format
    if (!/^\d+(\.\d+)?$/.test(value)) {
      throw new Error(`Invalid decimal string for ${name}`);
    }

    const [i, f = ''] = value.split('.');

    // Optimization: Remove trailing zeros that don't affect precision
    // This prevents "too many decimals" errors for values like "1.500" with decimals: 1
    const cleanF = f.replace(/0+$/, '');

    if (cleanF.length > decimals) {
      throw new Error(
        `${name} has too many decimals (${f.length} > ${decimals}). ` +
          `Value: ${value}. This would result in precision loss.`,
      );
    }

    // We use the original 'f' for padding to maintain the expected scale
    return BigInt(i + f.padEnd(decimals, '0'));
  }

  private formatFromBigInt(value: bigint, decimals: number): DecimalString {
    const s = value.toString().padStart(decimals + 1, '0');
    const i = s.slice(0, -decimals);
    const f = s.slice(-decimals);

    return decimals === 0 ? i : `${i}.${f}`;
  }

  multiply(
    value: DecimalString,
    multiplier: DecimalString,
    decimals: number,
    name = 'value',
  ): DecimalString {
    // 1. Détection de la précision native des entrées
    const vDecs = value.includes('.') ? value.split('.')[1].length : 0;
    const mDecs = multiplier.includes('.')
      ? multiplier.split('.')[1].length
      : 0;

    // 2. Conversion en BigInt sans perte (on utilise leur précision réelle)
    const a = this.parseToBigInt(value, vDecs, name);
    const b = this.parseToBigInt(multiplier, mDecs, 'multiplier');

    // 3. Produit brut (l'échelle combinée est vDecs + mDecs)
    const product = a * b;
    const currentScale = vDecs + mDecs;

    // 4. Ajustement vers l'échelle de sortie (target decimals)
    const scaleDiff = currentScale - decimals;

    let result: bigint;
    if (scaleDiff > 0) {
      // Trop de décimales : on réduit (division)
      // Note : BigInt fait une division entière (troncation)
      result = product / this.pow10(scaleDiff);
    } else if (scaleDiff < 0) {
      // Pas assez de décimales : on augmente (multiplication)
      result = product * this.pow10(Math.abs(scaleDiff));
    } else {
      result = product;
    }

    return this.formatFromBigInt(result, decimals);
  }

  divide(
    value: DecimalString,
    divisor: DecimalString,
    decimals: number,
    label = 'value',
  ): DecimalString {
    if (divisor === '0') {
      throw new Error(`${label ?? 'divide'}: division by zero`);
    }

    const factor = Math.pow(10, decimals);

    const result =
      Math.floor((Number(value) / Number(divisor)) * factor) / factor;

    return result.toFixed(decimals);
  }

  /**
   * Returns true if value is strictly greater than other. (a > b)
   */
  gt(a: DecimalString, b: DecimalString): boolean {
    return this.parse(a) > this.parse(b);
  }

  /**
   * Returns true if value is less than or equal to other. (a <= b)
   */
  lte(a: DecimalString, b: DecimalString): boolean {
    return this.parse(a) <= this.parse(b);
  }

  isPositive(value: DecimalString): boolean {
    return this.parse(value) > 0;
  }
}
