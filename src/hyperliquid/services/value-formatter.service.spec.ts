import { ValueFormatterService } from './value-formatter.service';

const formatter = new ValueFormatterService();

const REFERENCE_PERPS = [
  { asset: 'PURR', szDecimals: 0, minPrice: '0.0001', minSize: '1' },
  { asset: 'DYDX', szDecimals: 1, minPrice: '0.00001', minSize: '0.1' },
  { asset: 'SOL', szDecimals: 2, minPrice: '0.01', minSize: '0.01' },
  { asset: 'BNB', szDecimals: 3, minPrice: '0.1', minSize: '0.001' },
  { asset: 'ETH', szDecimals: 4, minPrice: '0.1', minSize: '0.0001' },
  { asset: 'BTC', szDecimals: 5, minPrice: '1', minSize: '0.00001' },
] as const;

const REFERENCE_SPOTS = [
  { asset: 'PURR/USDC', szDecimals: 0, minPrice: '0.0001', minSize: '1' },
  { asset: 'HYPE/USDC', szDecimals: 2, minPrice: '0.001', minSize: '0.01' },
  { asset: 'UETH/USDC', szDecimals: 4, minPrice: '0.1', minSize: '0.0001' },
] as const;

describe('formatPrice', () => {
  describe('sig figs', () => {
    it('should allow integers beyond sig fig limits', () => {
      expect(formatter.formatPrice('1234567', 0, 'perp')).toBe('1234567');
    });

    it('should truncate to 5 significant figures', () => {
      expect(formatter.formatPrice('12345.6', 0, 'perp')).toBe('12345');
      expect(formatter.formatPrice('0.00123456', 0, 'perp')).toBe('0.001234');
    });
  });

  describe('decimal limits', () => {
    it('perp: 6 - szDecimals', () => {
      expect(formatter.formatPrice('0.1234567', 0, 'perp')).toBe('0.12345');
      expect(formatter.formatPrice('123.456', 5, 'perp')).toBe('123.4');
    });

    it('spot: 8 - szDecimals', () => {
      expect(formatter.formatPrice('0.000123456', 0, 'spot')).toBe(
        '0.00012345',
      );
      expect(formatter.formatPrice('0.0001234', 3, 'spot')).toBe('0.00012');
    });
  });

  describe('normalization', () => {
    it('should remove trailing zeros', () => {
      expect(formatter.formatPrice('1.1000', 0, 'perp')).toBe('1.1');
    });

    it('should remove leading zeros', () => {
      expect(formatter.formatPrice('00.123', 0, 'perp')).toBe('0.123');
    });
  });

  describe('edge cases', () => {
    it('zero should return error', () => {
      expect(() => formatter.formatPrice('0.0000001', 0, 'perp')).toThrow(
        RangeError,
      );
    });

    it('negative numbers are supported', () => {
      expect(formatter.formatPrice('-123.456', 0, 'perp')).toBe('-123.45');
    });
  });

  describe('invalid input throws', () => {
    it('should throw for non-decimal formats', () => {
      expect(() => formatter.formatPrice('0x1A', 0)).toThrow();
      expect(() => formatter.formatPrice('1.23e5', 0)).toThrow();
      expect(() => formatter.formatPrice('abc', 0)).toThrow();
    });
  });

  describe('reference validation', () => {
    it('perpetuals minimum prices pass formatting unchanged', () => {
      for (const { szDecimals, minPrice } of REFERENCE_PERPS) {
        expect(formatter.formatPrice(minPrice, szDecimals, 'perp')).toBe(
          minPrice,
        );
      }
    });

    it('spots minimum prices pass formatting unchanged', () => {
      for (const { szDecimals, minPrice } of REFERENCE_SPOTS) {
        expect(formatter.formatPrice(minPrice, szDecimals, 'spot')).toBe(
          minPrice,
        );
      }
    });
  });
});

describe('formatSize', () => {
  it('should truncate to szDecimals', () => {
    expect(formatter.formatSize('123.456789', 2)).toBe('123.45');
  });

  describe('normalization', () => {
    it('should remove trailing zeros', () => {
      expect(formatter.formatSize('1.0000', 4)).toBe('1');
    });

    it('should remove leading zeros', () => {
      expect(formatter.formatSize('00.123', 3)).toBe('0.123');
    });
  });

  describe('edge cases', () => {
    it('zero should throw', () => {
      expect(() => formatter.formatSize('0.0000001', 0)).toThrow(RangeError);
    });

    it('negative numbers are supported', () => {
      expect(formatter.formatSize('-10.5', 1)).toBe('-10.5');
    });
  });

  describe('invalid input throws', () => {
    it('should reject invalid formats', () => {
      expect(() => formatter.formatSize('0xFF', 0)).toThrow();
      expect(() => formatter.formatSize('5e-3', 0)).toThrow();
      expect(() => formatter.formatSize('invalid', 0)).toThrow();
    });
  });

  describe('reference validation', () => {
    it('perpetuals minimum sizes pass unchanged', () => {
      for (const { szDecimals, minSize } of REFERENCE_PERPS) {
        expect(formatter.formatSize(minSize, szDecimals)).toBe(minSize);
      }
    });

    it('spots minimum sizes pass unchanged', () => {
      for (const { szDecimals, minSize } of REFERENCE_SPOTS) {
        expect(formatter.formatSize(minSize, szDecimals)).toBe(minSize);
      }
    });
  });
});
