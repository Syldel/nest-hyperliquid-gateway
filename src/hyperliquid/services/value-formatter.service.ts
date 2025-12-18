import { Injectable } from '@nestjs/common';

export type MarketType = 'perp' | 'spot';

@Injectable()
export class ValueFormatterService {
  private readonly MAX_DECIMALS: Record<MarketType, number> = {
    perp: 6,
    spot: 8,
  };

  /**
   * Format a price according to Hyperliquid rules:
   * - Max 5 significant figures
   * - Max (6 or 8) - szDecimals decimal places
   * - Integer prices always allowed
   *
   * @param price Price as string or number
   * @param szDecimals Number of size decimals of the asset
   * @param type Market type ("perp" or "spot"), default "perp"
   * @throws RangeError if truncated price is 0
   */
  formatPrice(
    price: string | number,
    szDecimals: number,
    type: MarketType = 'perp',
  ): string {
    price = String(price).trim();
    assertNumberString(price);

    // Integer bypasses sig figs
    if (/^-?\d+$/.test(price)) return formatDecimalString(price);

    const maxDecimals = Math.max(this.MAX_DECIMALS[type] - szDecimals, 0);

    // Apply decimal limit first
    price = StringMath.toFixedTruncate(price, maxDecimals);

    // Apply significant figures limit
    price = StringMath.toPrecisionTruncate(price, 5);

    if (price === '0') {
      throw new RangeError('Price is too small and was truncated to 0');
    }

    return price;
  }

  /**
   * Format size according to Hyperliquid rules:
   * - Truncate decimal places to szDecimals
   *
   * @param size Size as string or number
   * @param szDecimals Number of size decimals
   * @throws RangeError if truncated size is 0
   */
  formatSize(size: string | number, szDecimals: number): string {
    size = String(size).trim();
    assertNumberString(size);

    size = StringMath.toFixedTruncate(size, szDecimals);

    if (size === '0')
      throw new RangeError('Size is too small and was truncated to 0');

    return size;
  }
}

/** String-based math for arbitrary precision */
const StringMath = {
  log10Floor(value: string): number {
    const abs = value[0] === '-' ? value.slice(1) : value;
    const num = Number(abs);
    if (num === 0 || isNaN(num)) return -Infinity;
    const [int, dec = ''] = abs.split('.');
    if (Number(int) !== 0) {
      const trimmed = int.replace(/^0+/, '');
      return trimmed.length - 1;
    }
    const leadingZeros = dec.match(/^0*/)?.[0].length ?? 0;
    return -(leadingZeros + 1);
  },

  multiplyByPow10(value: string, exp: number): string {
    const neg = value[0] === '-' ? true : false;
    const abs = neg ? value.slice(1) : value;
    const [intRaw, dec = ''] = abs.split('.');
    const int = intRaw || '0';
    let result: string;

    if (exp > 0) {
      if (exp >= dec.length) result = int + dec + '0'.repeat(exp - dec.length);
      else result = int + dec.slice(0, exp) + '.' + dec.slice(exp);
    } else if (exp < 0) {
      const absExp = -exp;
      if (absExp >= int.length)
        result = '0.' + '0'.repeat(absExp - int.length) + int + dec;
      else result = int.slice(0, -absExp) + '.' + int.slice(-absExp) + dec;
    } else {
      result = int + (dec ? '.' + dec : '');
    }

    return formatDecimalString((neg ? '-' : '') + result);
  },

  trunc(value: string): string {
    const dotIndex = value.indexOf('.');
    return dotIndex === -1 ? value : value.slice(0, dotIndex) || '0';
  },

  toPrecisionTruncate(value: string, precision: number): string {
    if (!Number.isInteger(precision) || precision < 1)
      throw new RangeError('Precision must be a positive integer');

    if (/^-?0+(\.0*)?$/.test(value)) return '0';

    const neg = value[0] === '-' ? true : false;
    const abs = neg ? value.slice(1) : value;
    const magnitude = StringMath.log10Floor(abs);
    const shiftAmount = precision - magnitude - 1;
    const shifted = StringMath.multiplyByPow10(abs, shiftAmount);
    const truncated = StringMath.trunc(shifted);
    const result = StringMath.multiplyByPow10(truncated, -shiftAmount);

    return formatDecimalString(neg ? '-' + result : result);
  },

  toFixedTruncate(value: string, decimals: number): string {
    if (!Number.isInteger(decimals) || decimals < 0)
      throw new RangeError('Decimals must be a non-negative integer');
    const regex = new RegExp(`^-?(?:\\d+)?(?:\\.\\d{0,${decimals}})?`);
    const result = value.match(regex)?.[0];
    if (!result) throw new TypeError('Invalid number format');
    return formatDecimalString(result);
  },
};

/** Normalize decimal strings */
function formatDecimalString(value: string): string {
  return value
    .trim()
    .replace(/^(-?)0+(?=\d)/, '$1')
    .replace(/\.0*$|(\.\d+?)0+$/, '$1')
    .replace(/^(-?)\./, '$10.')
    .replace(/^-?$/, '0')
    .replace(/^-0$/, '0');
}

/** Validate numeric string */
function assertNumberString(value: string): void {
  if (!/^-?(\d+\.?\d*|\.\d*)$/.test(value)) {
    throw new TypeError(`Invalid number format: ${value}`);
  }
}
