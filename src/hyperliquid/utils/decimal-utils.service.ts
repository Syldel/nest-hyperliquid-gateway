import { Injectable } from '@nestjs/common';

import { DecimalString } from '../interfaces';

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

  private pow10(decimals: number): bigint {
    return BigInt(10) ** BigInt(decimals);
  }

  private parseToBigInt(
    value: DecimalString,
    decimals: number,
    name: string,
  ): bigint {
    if (!/^\d+(\.\d+)?$/.test(value)) {
      throw new Error(`Invalid decimal string for ${name}`);
    }

    const [i, f = ''] = value.split('.');
    if (f.length > decimals) {
      throw new Error(`${name} has too many decimals`);
    }

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
    const a = this.parseToBigInt(value, decimals, name);
    const b = this.parseToBigInt(multiplier, decimals, 'multiplier');

    const result = (a * b) / this.pow10(decimals);

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

  gt(a: DecimalString, b: DecimalString): boolean {
    return this.parse(a) > this.parse(b);
  }

  lte(a: DecimalString, b: DecimalString): boolean {
    return this.parse(a) <= this.parse(b);
  }

  isPositive(value: DecimalString): boolean {
    return this.parse(value) > 0;
  }
}
