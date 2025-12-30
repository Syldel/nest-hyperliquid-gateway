import { DecimalUtilsService } from './decimal-utils.service';

describe('DecimalUtilsService', () => {
  let service: DecimalUtilsService;

  beforeEach(() => {
    service = new DecimalUtilsService();
  });

  describe('parse', () => {
    it('should parse a valid decimal string', () => {
      expect(service.parse('123.45')).toBe(123.45);
    });

    it('should throw for invalid decimal string', () => {
      expect(() => service.parse('abc')).toThrow();
    });
  });

  describe('format', () => {
    it('should format number with given decimals', () => {
      expect(service.format(1.23456789, 4)).toBe('1.2346');
    });

    it('should remove trailing zeros', () => {
      expect(service.format(1.2, 6)).toBe('1.2');
    });
  });

  describe('multiply', () => {
    it('should multiply decimal string correctly', () => {
      const result = service.multiply('100', '0.25', 6);
      expect(result).toBe('25.000000');
    });

    it('should throw for invalid input', () => {
      expect(() => service.multiply('abc', '2', 6)).toThrow();
    });
  });

  describe('divide', () => {
    it('should divide decimal string correctly', () => {
      const result = service.divide('100', '4', 6);
      expect(result).toBe('25.000000');
    });

    it('should throw on division by zero', () => {
      expect(() => service.divide('100', '0', 6)).toThrow();
    });
  });

  describe('gt', () => {
    it('should return true when first value is greater', () => {
      expect(service.gt('2', '1')).toBe(true);
    });

    it('should return false otherwise', () => {
      expect(service.gt('1', '2')).toBe(false);
    });
  });

  describe('lte', () => {
    it('should return true when first value is less or equal', () => {
      expect(service.lte('1', '1')).toBe(true);
      expect(service.lte('1', '2')).toBe(true);
    });

    it('should return false otherwise', () => {
      expect(service.lte('2', '1')).toBe(false);
    });
  });

  describe('isPositive', () => {
    it('should return true for positive values', () => {
      expect(service.isPositive('0.0001')).toBe(true);
    });

    it('should return false for zero or negative values', () => {
      expect(service.isPositive('0')).toBe(false);
      expect(service.isPositive('-1')).toBe(false);
    });
  });
});
