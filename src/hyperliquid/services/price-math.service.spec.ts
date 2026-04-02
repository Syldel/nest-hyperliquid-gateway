import { Test, TestingModule } from '@nestjs/testing';

import { PriceMathService } from './price-math.service';

describe('PriceMathService', () => {
  let service: PriceMathService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PriceMathService],
    }).compile();

    service = module.get<PriceMathService>(PriceMathService);
  });

  describe('inferTickFromPrice', () => {
    it('should infer tick size for integer prices', () => {
      expect(service.inferTickFromPrice('100').toString()).toBe('1');
      expect(service.inferTickFromPrice('88275').toString()).toBe('1');
    });

    it('should infer tick size for decimal prices', () => {
      expect(service.inferTickFromPrice('2412.7').toString()).toBe('0.1');
      expect(service.inferTickFromPrice('0.01').toString()).toBe('0.01');
      expect(service.inferTickFromPrice('0.0002').toString()).toBe('0.0001');
    });

    it('should handle trailing zeros correctly', () => {
      expect(service.inferTickFromPrice('10.500').toString()).toBe('0.001');
      expect(service.inferTickFromPrice('1.2300').toString()).toBe('0.0001');
    });
  });

  describe('getOneTickAround', () => {
    it('should return prices one tick above and below', () => {
      const price = '100';
      const tick = '1';

      const result = service.getOneTickAround(price, tick);

      expect(result.below).toBe('99');
      expect(result.above).toBe('101');
    });

    it('should work with decimal tick sizes', () => {
      const price = '2412.7';
      const tick = '0.1';

      const result = service.getOneTickAround(price, tick);

      expect(result.below).toBe('2412.6');
      expect(result.above).toBe('2412.8');
    });

    it('should handle small decimal prices and ticks', () => {
      const price = '0.0002';
      const tick = '0.0001';

      const result = service.getOneTickAround(price, tick);

      expect(result.below).toBe('0.0001');
      expect(result.above).toBe('0.0003');
    });

    it('should respect the optional decimals parameter', () => {
      const price = '100';
      const tick = '1';
      // On force 2 décimales même si les entrées sont des entiers
      const result = service.getOneTickAround(price, tick, 2);

      expect(result.below).toBe('99'); // Ou '99.00' selon votre normalisation
      expect(result.above).toBe('101');
    });

    it('should handle prices with more decimals than the tick', () => {
      const price = '1.23456';
      const tick = '0.01';

      const result = service.getOneTickAround(price, tick);

      // Le calcul doit se baser sur la précision la plus fine (5 décimales)
      expect(result.below).toBe('1.22456');
      expect(result.above).toBe('1.24456');
    });

    it('should handle negative results correctly', () => {
      const price = '0.5';
      const tick = '1';

      const result = service.getOneTickAround(price, tick);

      expect(result.below).toBe('-0.5');
      expect(result.above).toBe('1.5');
    });
  });

  describe('getOneTickAroundPrice', () => {
    it('should compute tick and surrounding prices for integer price', () => {
      const result = service.getOneTickAroundPrice('88275');

      expect(result.tick.toString()).toBe('1');
      expect(result.below.toString()).toBe('88274');
      expect(result.above.toString()).toBe('88276');
    });

    it('should compute tick and surrounding prices for decimal price', () => {
      const result = service.getOneTickAroundPrice('2412.7');

      expect(result.tick.toString()).toBe('0.1');
      expect(result.below.toString()).toBe('2412.6');
      expect(result.above.toString()).toBe('2412.8');
    });

    it('should handle small decimal prices', () => {
      const result = service.getOneTickAroundPrice('0.0002');

      expect(result.tick.toString()).toBe('0.0001');
      expect(result.below.toString()).toBe('0.0001');
      expect(result.above.toString()).toBe('0.0003');
    });
  });
});
