import { Test, TestingModule } from '@nestjs/testing';

import {
  HLOrderStatusData,
  HLSuccessResponse,
  HLPlaceOrderResponse,
  HLOrderSize,
} from '../interfaces';
import { SmartOrderService } from './smart-order.service';
import { HyperliquidApiInfoService } from './hyperliquid-api-info.service';
import { HyperliquidApiTradeService } from './hyperliquid-api-trade.service';
import { DecimalUtilsService } from '../utils/decimal-utils.service';
import { PriceMathService } from './price-math.service';

describe('SmartOrderService', () => {
  let service: SmartOrderService;
  let infoService: HyperliquidApiInfoService;
  let tradeService: HyperliquidApiTradeService;
  let placeOrderSpy: jest.SpyInstance;
  let waitOrderSpy: jest.SpyInstance;
  let getOrderStatusSpy: jest.SpyInstance;
  let getPerpAccountStateSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmartOrderService,
        {
          provide: HyperliquidApiInfoService,
          useValue: {
            getPerpMarketsWithPrices: jest.fn(),
            getOrderStatus: jest.fn(),
            getPerpAccountState: jest.fn(),
          },
        },
        {
          provide: HyperliquidApiTradeService,
          useValue: {
            placeOrder: jest.fn(),
          },
        },
        DecimalUtilsService,
        PriceMathService,
      ],
    }).compile();

    service = module.get<SmartOrderService>(SmartOrderService);
    infoService = module.get<HyperliquidApiInfoService>(
      HyperliquidApiInfoService,
    );
    tradeService = module.get<HyperliquidApiTradeService>(
      HyperliquidApiTradeService,
    );
    placeOrderSpy = jest.spyOn(tradeService, 'placeOrder');
    waitOrderSpy = jest.spyOn(service, 'waitForOrderFinalStatus');
    getOrderStatusSpy = jest.spyOn(infoService, 'getOrderStatus');
    getPerpAccountStateSpy = jest.spyOn(infoService, 'getPerpAccountState');
  });

  it('should create order', async () => {
    const marketData = [{ name: 'BTC', markPrice: '50000', szDecimals: 8 }];
    (infoService.getPerpMarketsWithPrices as jest.Mock).mockResolvedValue(
      marketData,
    );
    waitOrderSpy.mockResolvedValue({
      finalStatus: 'filled',
      raw: { status: 'filled' } as HLOrderStatusData,
      timedOut: false,
    });

    const orderResponse = {
      status: 'ok',
      response: {
        type: 'order',
        data: { statuses: [{ resting: { oid: 12345 } }] },
      },
    };
    placeOrderSpy.mockResolvedValue(orderResponse);

    const params = {
      assetName: 'BTC',
      isBuy: true,
      size: { type: 'quote', usdc: '500' } as HLOrderSize,
    };

    const result = await service.instantOrder(params);

    expect(placeOrderSpy).toHaveBeenCalled();
    expect(result).toEqual({ status: 'filled' });
    expect(waitOrderSpy).toHaveBeenCalled();
  });

  it('should retry when order returns an "post only" error', async () => {
    const marketData = [{ name: 'BTC', markPrice: '50000', szDecimals: 8 }];
    (infoService.getPerpMarketsWithPrices as jest.Mock).mockResolvedValue(
      marketData,
    );
    waitOrderSpy.mockResolvedValue({
      finalStatus: 'filled',
      raw: { status: 'filled' } as HLOrderStatusData,
      timedOut: false,
    });

    const errorResponse: HLSuccessResponse<HLPlaceOrderResponse> = {
      status: 'ok',
      response: {
        type: 'order',
        data: {
          statuses: [
            { error: 'post only order would have immediately matched' },
          ],
        },
      },
    };

    const successResponse: HLSuccessResponse<HLPlaceOrderResponse> = {
      status: 'ok',
      response: {
        type: 'order',
        data: {
          statuses: [{ resting: { oid: 123456 } }],
        },
      },
    };

    placeOrderSpy
      .mockResolvedValueOnce(errorResponse)
      .mockResolvedValueOnce(successResponse);

    const size: HLOrderSize = { type: 'base', sz: '0.01' };

    await service.instantOrder({
      assetName: 'BTC',
      isBuy: true,
      size,
      maxRetries: 2,
      delayMs: 0,
    });

    expect(placeOrderSpy).toHaveBeenCalledTimes(2);
    expect(waitOrderSpy).toHaveBeenCalled();
  });

  it('should not retry when order returns an "insufficient margin" error', async () => {
    const marketData = [{ name: 'BTC', markPrice: '50000', szDecimals: 8 }];
    (infoService.getPerpMarketsWithPrices as jest.Mock).mockResolvedValue(
      marketData,
    );

    const errorResponse: HLSuccessResponse<HLPlaceOrderResponse> = {
      status: 'ok',
      response: {
        type: 'order',
        data: {
          statuses: [{ error: 'insufficient margin' }],
        },
      },
    };

    placeOrderSpy.mockResolvedValueOnce(errorResponse);

    const size: HLOrderSize = { type: 'base', sz: '0.01' };

    await expect(
      service.instantOrder({
        assetName: 'BTC',
        isBuy: true,
        size,
        maxRetries: 2,
        delayMs: 0,
      }),
    ).rejects.toMatchObject({
      response: {
        error: 'INSUFFICIENT_MARGIN',
      },
    });

    expect(placeOrderSpy).toHaveBeenCalledTimes(1);
    expect(waitOrderSpy).not.toHaveBeenCalled();
  });

  describe('waitForOrderFinalStatus', () => {
    it('should retry when order is open and return filled', async () => {
      getOrderStatusSpy
        .mockResolvedValueOnce({
          status: 'order',
          order: { status: 'open' },
        })
        .mockResolvedValueOnce({
          status: 'order',
          order: { status: 'filled' },
        });

      const result = await service.waitForOrderFinalStatus(infoService, {
        oid: 123,
        isTestnet: false,
        timeoutMs: 100,
        pollIntervalMs: 10,
      });

      expect(result.finalStatus).toBe('filled');
      expect(getOrderStatusSpy).toHaveBeenCalledTimes(2);
    });

    it('should timeout if order stays open', async () => {
      getOrderStatusSpy.mockResolvedValue({
        status: 'order',
        order: { status: 'open' },
      });

      const timeoutPromise = service.waitForOrderFinalStatus(infoService, {
        oid: 123,
        isTestnet: false,
        timeoutMs: 50,
        pollIntervalMs: 10,
      });

      await expect(timeoutPromise).resolves.toMatchObject({
        finalStatus: 'open',
        timedOut: true,
      });

      expect(getOrderStatusSpy).toHaveBeenCalled();
    });
  });

  describe('resolveQuoteFromPercent', () => {
    it('should compute quote amount from percent', async () => {
      getPerpAccountStateSpy.mockResolvedValue({
        marginSummary: {
          accountValue: '1000',
        },
      } as any);

      const result = await service.resolveQuoteFromPercent({
        percent: '0.1',
        isTestnet: false,
      });

      expect(result).toBe('100');
    });

    it('should support decimal percentages', async () => {
      getPerpAccountStateSpy.mockResolvedValue({
        marginSummary: {
          accountValue: '1234.56',
        },
      } as any);

      const result = await service.resolveQuoteFromPercent({
        percent: '0.25',
      });

      expect(result).toBe('308.64');
    });

    it('should throw if percent is zero', async () => {
      await expect(
        service.resolveQuoteFromPercent({
          percent: '0',
        }),
      ).rejects.toThrow();
    });

    it('should throw if percent is greater than one', async () => {
      await expect(
        service.resolveQuoteFromPercent({
          percent: '1.5',
        }),
      ).rejects.toThrow();
    });

    it('should throw if account value is not positive', async () => {
      getPerpAccountStateSpy.mockResolvedValue({
        marginSummary: {
          accountValue: '0',
        },
      } as any);

      await expect(
        service.resolveQuoteFromPercent({
          percent: '0.1',
        }),
      ).rejects.toThrow();
    });
  });
});
