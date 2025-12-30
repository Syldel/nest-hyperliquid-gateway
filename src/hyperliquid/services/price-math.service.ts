import { Injectable } from '@nestjs/common';

import { DecimalString } from '../interfaces';

@Injectable()
export class PriceMathService {
  inferTickFromPrice(price: DecimalString): DecimalString {
    const dot = price.indexOf('.');
    if (dot === -1) return '1';
    const decimals = price.length - dot - 1;
    return `0.${'0'.repeat(decimals - 1)}1`;
  }

  getOneTickAroundPrice(price: string): {
    tick: string;
    below: string;
    above: string;
  } {
    const tick = this.inferTickFromPrice(price);
    const { below, above } = this.getOneTickAround(price, tick);

    return { tick, below, above };
  }

  getOneTickAround(
    price: string,
    tick: string,
  ): {
    below: string;
    above: string;
  } {
    const decimals = tick.includes('.') ? tick.split('.')[1].length : 0;

    const factor = Math.pow(10, decimals);

    const priceInt = Math.round(Number(price) * factor);
    const tickInt = Math.round(Number(tick) * factor);

    const below = (priceInt - tickInt) / factor;
    const above = (priceInt + tickInt) / factor;

    return {
      below: this.normalizeDecimalString(below.toFixed(decimals)),
      above: this.normalizeDecimalString(above.toFixed(decimals)),
    };
  }

  private normalizeDecimalString(value: string): string {
    if (value.startsWith('.')) {
      return `0${value}`;
    }

    if (value.startsWith('-.')) {
      return value.replace('-.', '-0.');
    }

    return value;
  }
}
