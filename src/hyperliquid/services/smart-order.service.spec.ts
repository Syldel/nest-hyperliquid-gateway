import { Test, TestingModule } from '@nestjs/testing';

import {
  HLOrderStatusData,
  HLSuccessResponse,
  HLPlaceOrderResponse,
  HLOrderSize,
  HLOrderDetails,
} from '../interfaces';
import { SmartOrderService } from './smart-order.service';
import { HyperliquidApiInfoService } from './hyperliquid-api-info.service';
import { HyperliquidApiTradeService } from './hyperliquid-api-trade.service';
import { DecimalUtilsService } from '../utils/decimal-utils.service';
import { PriceMathService } from './price-math.service';
import { AssetRegistryService } from './asset-registry.service';

describe('SmartOrderService', () => {
  let service: SmartOrderService;
  let infoService: HyperliquidApiInfoService;
  let tradeService: HyperliquidApiTradeService;
  let assetRegistry: AssetRegistryService;

  let placeOrderSpy: jest.SpyInstance;
  let waitOrderSpy: jest.SpyInstance;
  let getOrderStatusSpy: jest.SpyInstance;
  let getPerpAccountStateSpy: jest.SpyInstance;
  let getFrontendOpenOrdersSpy: jest.SpyInstance;
  let batchModifyOrdersSpy: jest.SpyInstance;
  let cancelOrderSpy: jest.SpyInstance;
  let getAssetId: jest.SpyInstance;

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
            getFrontendOpenOrders: jest.fn(),
          },
        },
        {
          provide: HyperliquidApiTradeService,
          useValue: {
            placeOrder: jest.fn(),
            batchModifyOrders: jest.fn(),
            cancelOrder: jest.fn(),
          },
        },
        DecimalUtilsService,
        PriceMathService,
        {
          provide: AssetRegistryService,
          useValue: {
            getAssetId: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SmartOrderService>(SmartOrderService);
    infoService = module.get<HyperliquidApiInfoService>(
      HyperliquidApiInfoService,
    );
    tradeService = module.get<HyperliquidApiTradeService>(
      HyperliquidApiTradeService,
    );
    assetRegistry = module.get<AssetRegistryService>(AssetRegistryService);
    placeOrderSpy = jest.spyOn(tradeService, 'placeOrder');
    waitOrderSpy = jest.spyOn(service, 'waitForOrderFinalStatus');
    getOrderStatusSpy = jest.spyOn(infoService, 'getOrderStatus');
    getPerpAccountStateSpy = jest.spyOn(infoService, 'getPerpAccountState');

    getFrontendOpenOrdersSpy = jest.spyOn(infoService, 'getFrontendOpenOrders');
    batchModifyOrdersSpy = jest.spyOn(tradeService, 'batchModifyOrders');
    cancelOrderSpy = jest.spyOn(tradeService, 'cancelOrder');
    getAssetId = jest.spyOn(assetRegistry, 'getAssetId');
  });

  describe('instantOrder', () => {
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

  describe('placeBatchProtectiveOrders', () => {
    const assetName = 'BTC';
    const isBuy = true;

    function makeFrontendProtectiveOrder(params: {
      assetName: string;
      oid: number;
      kind: 'tp' | 'sl';
      price: string;
      sz: string;
      side: 'A' | 'B';
      isMarket?: boolean;
      timestamp?: number;
    }) {
      const {
        assetName,
        oid,
        kind,
        price,
        sz,
        side,
        isMarket = true,
        timestamp = Date.now(),
      } = params;

      return {
        coin: assetName,
        oid,
        sz,
        limitPx: isMarket ? '0' : price,
        side,
        timestamp,

        // flags Hyperliquid
        isTrigger: true,
        reduceOnly: true,
        isPositionTpsl: true,

        // frontend-only
        orderType: isMarket ? 'Market' : 'Limit',
        triggerPx: price,
        triggerCondition: kind === 'tp' ? 'Profit target' : 'Stop loss',
        origSz: sz,
      };
    }

    function makeOrderFromSpec(spec: string, assetName: string) {
      const parts = spec.split('_');

      if (parts.length !== 4) {
        throw new Error(
          `Invalid spec "${spec}". Expected format: oid_sz_price_kind`,
        );
      }

      const [oidStr, sz, price, kindStr] = parts;

      if (kindStr !== 'tp' && kindStr !== 'sl') {
        throw new Error(`Invalid kind "${kindStr}" in spec "${spec}"`);
      }

      const oid = Number(oidStr);

      if (Number.isNaN(oid)) {
        throw new Error(`Invalid oid "${oidStr}" in spec "${spec}"`);
      }

      const kind = kindStr;

      return makeFrontendProtectiveOrder({
        assetName,
        oid,
        sz,
        price,
        kind,
        side: 'B',
      });
    }

    beforeEach(() => {
      getFrontendOpenOrdersSpy.mockResolvedValue([]);
      batchModifyOrdersSpy.mockResolvedValue({});
      cancelOrderSpy.mockResolvedValue({});
      placeOrderSpy.mockResolvedValue({});
      getAssetId.mockReturnValue(0);
    });

    it('should create new TP and SL orders and push correct oids', async () => {
      getFrontendOpenOrdersSpy.mockResolvedValue([]);

      placeOrderSpy
        .mockResolvedValueOnce({
          response: { data: { statuses: [{ resting: { oid: 1001 } }] } },
        })
        .mockResolvedValueOnce({
          response: { data: { statuses: [{ resting: { oid: 2001 } }] } },
        });

      const params = {
        assetName,
        isBuy,
        tp: [{ sz: '0.5', price: '9000' }],
        sl: [{ sz: '0.3', price: '8000' }],
      };

      const result = await service.placeBatchProtectiveOrders(params, false);

      expect(result.tp.created).toEqual([1001]);
      expect(result.sl.created).toEqual([2001]);
    });

    it('should cancel existing TP and SL orders', async () => {
      getFrontendOpenOrdersSpy.mockResolvedValue([
        makeOrderFromSpec('101_0.5_9000_tp', assetName),
        makeOrderFromSpec('102_0.3_8000_sl', assetName),
      ]);

      getAssetId.mockReturnValue(4);

      const params = { assetName, isBuy }; // pas de nouveaux ordres

      await service.placeBatchProtectiveOrders(params, false);

      expect(cancelOrderSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          { oid: 101, asset: 4 },
          { oid: 102, asset: 4 },
        ]),
        false,
      );
    });

    it('should update existing TP and SL orders', async () => {
      getFrontendOpenOrdersSpy.mockResolvedValue([
        makeOrderFromSpec('101_0.5_9000_tp', assetName),
        makeOrderFromSpec('102_0.3_8000_sl', assetName),
      ]);

      const params = {
        assetName,
        isBuy,
        tp: [{ sz: '0.6', price: '9100' }], // modifie TP
        sl: [{ sz: '0.35', price: '8100' }], // modifie SL
      };

      await service.placeBatchProtectiveOrders(params, false);

      expect(batchModifyOrdersSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            oid: 101,
            order: expect.objectContaining({
              sz: '0.6',
              limitPx: '9100',
            }) as unknown as HLOrderDetails,
          }),
          expect.objectContaining({
            oid: 102,
            order: expect.objectContaining({
              sz: '0.35',
              limitPx: '8100',
            }) as unknown as HLOrderDetails,
          }),
        ]),
        false,
      );
    });

    it('should update 2 orders, cancel 1 SL an add 1 TP', async () => {
      const existing = [
        makeOrderFromSpec('101_0.5_9000_tp', assetName),
        makeOrderFromSpec('102_0.3_8000_sl', assetName),
        makeOrderFromSpec('103_0.2_8100_sl', assetName),
      ];

      // DESIRED orders
      const desired = {
        assetName,
        isBuy,
        tp: [
          { kind: 'tp', price: '9100', sz: '0.6' }, // update TP 101
          { kind: 'tp', price: '9200', sz: '0.2' }, // new TP to create
        ],
        sl: [
          { kind: 'sl', price: '7900', sz: '0.25' }, // update SL 103
        ],
      };

      getFrontendOpenOrdersSpy.mockResolvedValue(existing);

      placeOrderSpy.mockResolvedValue({
        response: { data: { statuses: [{ resting: { oid: 201 } }] } },
      });

      getAssetId.mockReturnValue(7);

      const result = await service.placeBatchProtectiveOrders(desired, false);

      // ✅ Expectations
      expect(getFrontendOpenOrdersSpy).toHaveBeenCalled();
      expect(batchModifyOrdersSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ oid: 101 }), // TP
          expect.objectContaining({
            oid: 103,
            order: expect.objectContaining({
              limitPx: '7900',
              sz: '0.25',
            }) as unknown,
          }), // SL
        ]),
        false,
      );
      expect(placeOrderSpy).toHaveBeenCalledWith({
        isTestnet: false,
        order: {
          assetName: 'BTC',
          isBuy: true,
          limitPx: '9200',
          orderType: {
            trigger: { isMarket: true, tpsl: 'tp', triggerPx: '9200' },
          },
          reduceOnly: true,
          sz: '0.2',
        },
      });
      expect(cancelOrderSpy).toHaveBeenCalledWith(
        expect.arrayContaining([{ oid: 102, asset: 7 }]),
        false,
      );

      // Check created / updated / cancelled
      expect(result.tp.updated).toContain(101);
      expect(result.tp.created).toContain(201); // new TP
      expect(result.tp.cancelled).toHaveLength(0);

      expect(result.sl.updated).toContain(103);
      expect(result.sl.created).toHaveLength(0);
      expect(result.sl.cancelled).toContain(102); // SL 102 removed
    });

    it('should update 2 orders, cancel 1 TP an add 1 SL', async () => {
      const existing = [
        makeOrderFromSpec('101_0.5_9000_tp', assetName),
        makeOrderFromSpec('102_0.3_8000_sl', assetName),
        makeOrderFromSpec('104_0.4_9500_tp', assetName),
      ];

      // DESIRED orders
      const desired = {
        assetName,
        isBuy,
        tp: [{ kind: 'tp', price: '9100', sz: '0.6' }],
        sl: [
          { kind: 'sl', price: '7900', sz: '0.25' },
          { kind: 'sl', price: '7600', sz: '0.35' },
        ],
      };

      getFrontendOpenOrdersSpy.mockResolvedValue(existing);

      placeOrderSpy.mockResolvedValue({
        response: { data: { statuses: [{ resting: { oid: 201 } }] } },
      });

      getAssetId.mockReturnValue(7);

      const result = await service.placeBatchProtectiveOrders(desired, false);

      // ✅ Expectations
      expect(getFrontendOpenOrdersSpy).toHaveBeenCalled();
      expect(batchModifyOrdersSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ oid: 101 }), // TP
          expect.objectContaining({
            oid: 102,
            order: expect.objectContaining({
              limitPx: '7900',
              sz: '0.25',
            }) as unknown,
          }), // SL
        ]),
        false,
      );
      expect(placeOrderSpy).toHaveBeenCalledWith({
        isTestnet: false,
        order: {
          assetName: 'BTC',
          isBuy: true,
          limitPx: '7600',
          orderType: {
            trigger: { isMarket: true, tpsl: 'sl', triggerPx: '7600' },
          },
          reduceOnly: true,
          sz: '0.35',
        },
      });
      expect(cancelOrderSpy).toHaveBeenCalledWith(
        expect.arrayContaining([{ oid: 104, asset: 7 }]),
        false,
      );

      // Check created / updated / cancelled
      expect(result.tp.updated).toContain(101);
      expect(result.tp.created).toHaveLength(0);
      expect(result.tp.cancelled).toContain(104);

      expect(result.sl.updated).toContain(102);
      expect(result.sl.created).toContain(201);
      expect(result.sl.cancelled).toHaveLength(0);
    });
  });
});
