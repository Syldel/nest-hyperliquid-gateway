import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import {
  HLOrderStatusData,
  HLSuccessResponse,
  HLPlaceOrderResponse,
  HLOrderSize,
  HLOrderDetails,
  HLModifyInput,
  ExistingProtectiveOrder,
} from '@syldel/hl-shared-types';
import { SmartOrderService } from './smart-order.service';
import { HyperliquidApiPrivateInfoService } from './hyperliquid-api-private-info.service';
import { HyperliquidApiPublicInfoService } from './hyperliquid-api-public-info.service';
import { HyperliquidApiTradeService } from './hyperliquid-api-trade.service';
import { DecimalUtilsService } from '../utils/decimal-utils.service';
import { PriceMathService } from './price-math.service';
import { AssetRegistryService } from './asset-registry.service';
import { ValueFormatterService } from './value-formatter.service';
import { HyperliquidCollateralService } from './hyperliquid-collateral.service';
import { HyperliquidGatewayException } from '../exceptions/hyperliquid-gateway.exception';

describe('SmartOrderService', () => {
  let service: SmartOrderService;
  let privateInfoService: HyperliquidApiPrivateInfoService;
  let publicInfoService: HyperliquidApiPublicInfoService;
  let tradeService: HyperliquidApiTradeService;
  let assetRegistry: AssetRegistryService;
  let collateralService: HyperliquidCollateralService;

  let placeOrderSpy: jest.SpyInstance;
  let waitOrderSpy: jest.SpyInstance;
  let getOrderStatusSpy: jest.SpyInstance;
  let getFrontendOpenOrdersSpy: jest.SpyInstance;
  let batchModifyOrdersSpy: jest.SpyInstance;
  let cancelOrderSpy: jest.SpyInstance;
  let getAssetId: jest.SpyInstance;
  let getSzDecimals: jest.SpyInstance;
  let isPerp: jest.SpyInstance;
  let getDexForAsset: jest.SpyInstance;
  let getCollateralBalance: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmartOrderService,
        {
          provide: HyperliquidApiPrivateInfoService,
          useValue: {
            getOrderStatus: jest.fn(),
            getPerpAccountState: jest.fn(),
            getFrontendOpenOrders: jest.fn(),
          },
        },
        {
          provide: HyperliquidApiPublicInfoService,
          useValue: {
            getPerpMarketsWithPrices: jest.fn(),
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
            getSzDecimals: jest.fn(),
            isPerp: jest.fn(),
            getDexForAsset: jest.fn(),
          },
        },
        ValueFormatterService,
        {
          provide: HyperliquidCollateralService,
          useValue: {
            getCollateralBalance: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SmartOrderService>(SmartOrderService);
    privateInfoService = module.get<HyperliquidApiPrivateInfoService>(
      HyperliquidApiPrivateInfoService,
    );
    publicInfoService = module.get<HyperliquidApiPublicInfoService>(
      HyperliquidApiPublicInfoService,
    );
    tradeService = module.get<HyperliquidApiTradeService>(
      HyperliquidApiTradeService,
    );
    assetRegistry = module.get<AssetRegistryService>(AssetRegistryService);
    collateralService = module.get<HyperliquidCollateralService>(
      HyperliquidCollateralService,
    );

    placeOrderSpy = jest.spyOn(tradeService, 'placeOrder');
    waitOrderSpy = jest.spyOn(service, 'waitForOrderFinalStatus');
    getOrderStatusSpy = jest.spyOn(privateInfoService, 'getOrderStatus');
    getFrontendOpenOrdersSpy = jest.spyOn(
      privateInfoService,
      'getFrontendOpenOrders',
    );
    batchModifyOrdersSpy = jest.spyOn(tradeService, 'batchModifyOrders');
    cancelOrderSpy = jest.spyOn(tradeService, 'cancelOrder');
    getAssetId = jest.spyOn(assetRegistry, 'getAssetId');
    getSzDecimals = jest.spyOn(assetRegistry, 'getSzDecimals');
    isPerp = jest.spyOn(assetRegistry, 'isPerp');
    getDexForAsset = jest.spyOn(assetRegistry, 'getDexForAsset');
    getCollateralBalance = jest.spyOn(
      collateralService,
      'getCollateralBalance',
    );
  });

  describe('instantOrder', () => {
    it('should create order', async () => {
      const marketData = [{ name: 'BTC', markPrice: '50000', szDecimals: 8 }];
      (
        publicInfoService.getPerpMarketsWithPrices as jest.Mock
      ).mockResolvedValue(marketData);
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
      (
        publicInfoService.getPerpMarketsWithPrices as jest.Mock
      ).mockResolvedValue(marketData);
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
      (
        publicInfoService.getPerpMarketsWithPrices as jest.Mock
      ).mockResolvedValue(marketData);

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

      const result = await service.waitForOrderFinalStatus(privateInfoService, {
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

      const timeoutPromise = service.waitForOrderFinalStatus(
        privateInfoService,
        {
          oid: 123,
          isTestnet: false,
          timeoutMs: 50,
          pollIntervalMs: 10,
        },
      );

      await expect(timeoutPromise).resolves.toMatchObject({
        finalStatus: 'open',
        timedOut: true,
      });

      expect(getOrderStatusSpy).toHaveBeenCalled();
    });
  });

  describe('resolveQuoteFromPercent', () => {
    it('should compute quote amount from percent', async () => {
      getCollateralBalance.mockResolvedValue({
        status: 'ok',
        mode: 'unifiedAccount',
        collateralToken: 0,
        total: '1000',
        used: '650',
        collateral: 'USDC',
      });

      const result = await service.resolveQuoteFromPercent({
        percent: '0.1',
        asset: 'BTC',
        isTestnet: false,
      });

      expect(result).toBe('100');
    });

    /**
     * Le paramètre `asset` n'est pas décoratif : depuis que le collatéral se
     * dérive du catalogue, c'est lui qui détermine **dans quel actif** le solde
     * est lu. Un marché `cash:TSLA` ne se règle pas dans le même token que
     * `BTC`.
     *
     * Ces tests l'omettaient — le mock ignorait l'argument, donc ils passaient
     * avec `asset === undefined`, une forme d'appel qui ne peut pas exister en
     * production. Seul le compilateur le voyait, et ses alertes se perdaient
     * dans sept autres.
     */
    it('passes the asset through, since it decides which balance is read', async () => {
      getCollateralBalance.mockResolvedValue({
        status: 'ok',
        mode: 'unifiedAccount',
        collateralToken: 2,
        total: '1000',
        used: '0',
        collateral: 'USDT',
      });

      await service.resolveQuoteFromPercent({
        percent: '0.1',
        asset: 'cash:TSLA',
      });

      expect(getCollateralBalance).toHaveBeenCalledWith('cash:TSLA');
    });

    it('should support decimal percentages', async () => {
      getCollateralBalance.mockResolvedValue({
        status: 'ok',
        mode: 'unifiedAccount',
        collateralToken: 0,
        total: '1234.56',
        used: '650',
        collateral: 'USDC',
      });

      const result = await service.resolveQuoteFromPercent({
        percent: '0.25',
        asset: 'BTC',
      });

      expect(result).toBe('308.64');
    });

    it('should throw if percent is zero', async () => {
      await expect(
        service.resolveQuoteFromPercent({
          percent: '0',
          asset: 'BTC',
        }),
      ).rejects.toThrow();
    });

    it('should throw if percent is greater than one', async () => {
      await expect(
        service.resolveQuoteFromPercent({
          percent: '1.5',
          asset: 'BTC',
        }),
      ).rejects.toThrow();
    });

    it('should throw if account value is not positive', async () => {
      getCollateralBalance.mockResolvedValue({
        status: 'ok',
        mode: 'unifiedAccount',
        collateralToken: 0,
        total: '0',
        used: '650',
        collateral: 'USDC',
      });

      await expect(
        service.resolveQuoteFromPercent({
          percent: '0.1',
          asset: 'BTC',
        }),
      ).rejects.toThrow();
    });

    /**
     * Les trois refus portent des codes distincts, et ce n'est pas cosmétique :
     * ils désignent trois suites différentes. Approvisionner le compte ne répare
     * pas un marché dont on ignore le règlement, et changer de mode de compte ne
     * répare ni l'un ni l'autre. Tant que le collatéral introuvable rendait
     * `'0'`, les trois sortaient sous « fonds insuffisants ».
     */
    it('tells an unresolved collateral apart from a lack of funds', async () => {
      getCollateralBalance.mockResolvedValue({
        status: 'unknown-collateral',
        mode: 'unifiedAccount',
      });

      // Le nom du marché vient de la requête : le résultat du service ne le porte plus.
      const refusal = service.resolveQuoteFromPercent({
        percent: '0.1',
        asset: 'NOPE',
      });

      await expect(refusal).rejects.toMatchObject({
        response: { error: 'UNKNOWN_COLLATERAL' },
      });
      await expect(refusal).rejects.toThrow('"NOPE"');
    });

    it('tells an unreadable account mode apart from a lack of funds', async () => {
      getCollateralBalance.mockResolvedValue({
        status: 'unsupported-mode',
        mode: 'portfolioMargin',
      });

      await expect(
        service.resolveQuoteFromPercent({ percent: '0.1', asset: 'BTC' }),
      ).rejects.toMatchObject({
        response: { error: 'UNSUPPORTED_ACCOUNT_MODE' },
      });
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
      side: 'A' | 'B'; // 'A' = Ask (Sell), 'B' = Bid (Buy)
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

      const preciseOrderType =
        kind === 'tp'
          ? isMarket
            ? 'Take Profit Market'
            : 'Take Profit Limit'
          : isMarket
            ? 'Stop Market'
            : 'Stop Limit';

      const conditionText =
        kind === 'tp'
          ? `Price ${side === 'B' ? 'below' : 'above'} ${price}`
          : `Price ${side === 'B' ? 'above' : 'below'} ${price}`;

      return {
        coin: assetName,
        oid,
        sz,
        limitPx: price,
        side,
        timestamp,

        // flags Hyperliquid
        isTrigger: true,
        reduceOnly: true,
        isPositionTpsl: false,

        // frontend-only
        orderType: preciseOrderType,
        triggerPx: price,
        triggerCondition: conditionText,
        origSz: sz,
        children: [],
        cloid: null,
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
      // Pas de réponse par défaut : `{}` n'est pas ce que l'exchange rend, et le gateway la traite en refus. Un test qui
      // modifie dit ce que l'exchange répond.
      cancelOrderSpy.mockResolvedValue({
        status: 'ok',
        response: {
          type: 'cancel',
          data: {
            statuses: ['success'],
          },
        },
      });
      placeOrderSpy.mockResolvedValue({});
      getAssetId.mockReturnValue(0);
      getSzDecimals.mockReturnValue(6);
      isPerp.mockReturnValue(true);
      getDexForAsset.mockReturnValue('');
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
      batchModifyOrdersSpy.mockResolvedValue({
        status: 'ok',
        response: {
          data: {
            statuses: [{ resting: { oid: 1101 } }, { resting: { oid: 1102 } }],
          },
        },
      });

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
              limitPx: '10010',
            }) as unknown as HLOrderDetails,
          }),
          expect.objectContaining({
            oid: 102,
            order: expect.objectContaining({
              sz: '0.35',
              limitPx: '8910',
            }) as unknown as HLOrderDetails,
          }),
        ]),
        false,
      );
    });

    it('leaves an unchanged protective order alone when Hyperliquid spells it with a decimal', async () => {
      // Test de regression du defaut mesure le 2026-09-22 lors du test en
      // conditions reelles du bot : Hyperliquid rend un prix entier avec une
      // decimale (« 1103.0 ») quand `formatPrice` rend « 1103 ». Les deux cotes
      // etaient compares en chaines, donc un take-profit inchange etait modifie
      // a chaque passage, et recevait un nouvel oid. Un stop a 1 068,1, ecrit
      // pareil des deux cotes, etait laisse tel quel — d'ou le second ordre
      // ci-dessous, qui doit lui aussi rester tranquille.
      getSzDecimals.mockReturnValue(2);
      isPerp.mockReturnValue(true);
      getAssetId.mockReturnValue(7);

      const existing = [
        makeFrontendProtectiveOrder({
          assetName,
          oid: 301,
          kind: 'tp',
          price: '1103.0',
          sz: '2.00',
          side: 'B',
        }),
        makeFrontendProtectiveOrder({
          assetName,
          oid: 302,
          kind: 'sl',
          price: '1068.1',
          sz: '2.00',
          side: 'B',
        }),
      ];
      getFrontendOpenOrdersSpy.mockResolvedValue(existing);

      await service.placeBatchProtectiveOrders(
        {
          assetName,
          isBuy,
          tp: [{ price: '1103', sz: '2' }],
          sl: [{ price: '1068.1', sz: '2' }],
        },
        false,
      );

      // Rien ne doit partir : les deux protections sont deja en place.
      expect(batchModifyOrdersSpy).not.toHaveBeenCalled();
      expect(placeOrderSpy).not.toHaveBeenCalled();
      expect(cancelOrderSpy).not.toHaveBeenCalled();
    });

    it('still modifies a protective order whose price really changed', async () => {
      // La contrepartie : normaliser les deux cotes ne doit pas rendre le
      // gateway aveugle a un vrai changement.
      getSzDecimals.mockReturnValue(2);
      isPerp.mockReturnValue(true);
      getAssetId.mockReturnValue(7);

      getFrontendOpenOrdersSpy.mockResolvedValue([
        makeFrontendProtectiveOrder({
          assetName,
          oid: 301,
          kind: 'tp',
          price: '1103.0',
          sz: '2.00',
          side: 'B',
        }),
      ]);
      batchModifyOrdersSpy.mockResolvedValue({
        status: 'ok',
        response: { data: { statuses: [{ resting: { oid: 1301 } }] } },
      });

      await service.placeBatchProtectiveOrders(
        {
          assetName,
          isBuy,
          tp: [{ price: '1104', sz: '2' }],
        },
        false,
      );

      expect(batchModifyOrdersSpy).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ oid: 301 })]),
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
          { price: '9100', sz: '0.6' }, // update TP 101
          { price: '9200', sz: '0.2' }, // new TP to create
        ],
        sl: [
          { price: '7900', sz: '0.25' }, // update SL 103
        ],
      };

      getFrontendOpenOrdersSpy.mockResolvedValue(existing);

      placeOrderSpy.mockResolvedValue({
        response: { data: { statuses: [{ resting: { oid: 201 } }] } },
      });

      batchModifyOrdersSpy.mockResolvedValue({
        status: 'ok',
        response: {
          data: {
            statuses: [{ resting: { oid: 1111 } }, { resting: { oid: 1222 } }],
          },
        },
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
              limitPx: '8690',
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
          limitPx: '10120',
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
      expect(result.tp.updated).toContain(1111); // TP 101 => TP 1111
      expect(result.tp.created).toContain(201); // new TP
      expect(result.tp.cancelled).toHaveLength(0);

      expect(result.sl.updated).toContain(1222); // SL 103 => SL 1222
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
        tp: [{ price: '9100', sz: '0.6' }],
        sl: [
          { price: '7900', sz: '0.25' },
          { price: '7600', sz: '0.35' },
        ],
      };

      getFrontendOpenOrdersSpy.mockResolvedValue(existing);

      placeOrderSpy.mockResolvedValue({
        response: { data: { statuses: [{ resting: { oid: 201 } }] } },
      });

      batchModifyOrdersSpy.mockResolvedValue({
        status: 'ok',
        response: {
          data: {
            statuses: [{ resting: { oid: 1555 } }, { resting: { oid: 1666 } }],
          },
        },
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
              limitPx: '8690',
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
          limitPx: '8360',
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
      expect(result.tp.updated).toContain(1555); // TP 101 => TP 1555
      expect(result.tp.created).toHaveLength(0);
      expect(result.tp.cancelled).toContain(104);

      expect(result.sl.updated).toContain(1666); // SL 102 => SL 1666
      expect(result.sl.created).toContain(201);
      expect(result.sl.cancelled).toHaveLength(0);
    });

    it('should update 2 orders, cancel 1 TP and add 1 SL when short', async () => {
      const isBuy = false;

      const existing = [
        makeOrderFromSpec('101_0.5_9000_sl', assetName),
        makeOrderFromSpec('102_0.3_8000_tp', assetName),
        makeOrderFromSpec('103_0.2_7500_tp', assetName),
      ];

      const desired = {
        assetName,
        isBuy,
        tp: [{ price: '8200', sz: '0.6' }],
        sl: [
          { price: '9100', sz: '0.25' },
          { price: '9200', sz: '0.35' },
        ],
      };

      getFrontendOpenOrdersSpy.mockResolvedValue(existing);

      placeOrderSpy.mockResolvedValue({
        response: {
          data: {
            statuses: [{ resting: { oid: 201 } }],
          },
        },
      });

      batchModifyOrdersSpy.mockResolvedValue({
        status: 'ok',
        response: {
          data: {
            statuses: [{ resting: { oid: 1777 } }, { resting: { oid: 1888 } }],
          },
        },
      });

      getAssetId.mockReturnValue(7);

      const result = await service.placeBatchProtectiveOrders(desired, false);

      expect(getFrontendOpenOrdersSpy).toHaveBeenCalled();

      expect(batchModifyOrdersSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            oid: 102,
            order: expect.objectContaining({
              limitPx: '7381',
              sz: '0.6',
            }) as unknown,
          }), // TP
          expect.objectContaining({
            oid: 101,
            order: expect.objectContaining({
              limitPx: '8191',
              sz: '0.25',
            }) as unknown,
          }), // SL
        ]),
        false,
      );

      expect(cancelOrderSpy).toHaveBeenCalledWith(
        [{ oid: 103, asset: 7 }],
        false,
      );

      expect(placeOrderSpy).toHaveBeenCalledWith({
        isTestnet: false,
        order: {
          assetName: 'BTC',
          isBuy: false,
          limitPx: '8281',
          orderType: {
            trigger: {
              isMarket: true,
              tpsl: 'sl',
              triggerPx: '9200',
            },
          },
          reduceOnly: true,
          sz: '0.35',
        },
      });

      expect(result.tp.updated).toEqual([1777]); // TP 102 => TP 1777
      expect(result.tp.cancelled).toEqual([103]);
      expect(result.tp.created).toHaveLength(0);

      expect(result.sl.updated).toEqual([1888]); // SL 101 => SL 1888
      expect(result.sl.created).toEqual([201]);
      expect(result.sl.cancelled).toHaveLength(0);
    });

    /**
     * Ce que le réalignement fait d'un `batchModify` que l'exchange ne reconnaît pas comme accepté.
     *
     * Avant, `if (response.status === 'ok')` sautait tout le bloc sans un mot, puis les annulations et les créations du même
     * passage partaient : un plan qui mêle une modification et une création rendait un compte rendu NON vide alors que la
     * modification n'avait pas eu lieu, et le bot lisait `protected`.
     *
     * Ce qui compte ici est l'ORDRE : ce qui protège part d'abord, l'échec vient après. Lever dès le refus laisserait sans
     * stop une position dont le stop manque et dont un TP périmé est refusé (mesuré dans une copie jetable le 2026-10-27 :
     * l'ancien code posait le stop, une version qui lève d'emblée ne le posait pas). Le refus est donc consigné au journal tout
     * de suite, le plan se termine, puis le gateway lève en disant ce qui a été envoyé.
     *
     * ⚠️ Le TEXTE d'un refus de `modify` par l'exchange n'est pas connu (non mesuré) : les doubles n'en inventent qu'un libellé
     * neutre, que le code ne lit pas. Seule l'enveloppe `{ status: 'err', response: <texte> }` est connue, c'est celle que
     * `executeWithNonce` teste déjà (avec un texte mesuré, pour la limite par adresse).
     */
    describe('a batchModify the exchange does not accept', () => {
      // Une cible périmée de deux ordres, plus un TP à créer : deux modifications et une création dans le même plan.
      const desired = {
        assetName,
        isBuy,
        tp: [
          { price: '9100', sz: '0.6' }, // modifie le TP 101
          { price: '9200', sz: '0.2' }, // à créer
        ],
        sl: [{ price: '8100', sz: '0.35' }], // modifie le SL 102
      };

      const refusedText = '<placeholder, not a measured message>';
      const refusal = { status: 'err', response: refusedText };

      let logError: jest.SpyInstance;

      beforeEach(() => {
        logError = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined);
        getFrontendOpenOrdersSpy.mockResolvedValue([
          makeOrderFromSpec('101_0.5_9000_tp', assetName),
          makeOrderFromSpec('102_0.3_8000_sl', assetName),
        ]);
        getAssetId.mockReturnValue(7);
        placeOrderSpy.mockResolvedValue({
          response: { data: { statuses: [{ resting: { oid: 201 } }] } },
        });
      });

      afterEach(() => logError.mockRestore());

      const failureOf = async (run: Promise<unknown>) => {
        const error = await run.then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(HyperliquidGatewayException);
        return error as HyperliquidGatewayException;
      };

      it.each([
        ['an err envelope', refusal],
        ['an empty object', {}],
        ['a null body', null],
        ['no body at all', undefined],
      ])(
        'ends with a clear refusal (422) on %s, not with an unknown state',
        async (_label, answer) => {
          batchModifyOrdersSpy.mockResolvedValue(answer);

          const error = await failureOf(
            service.placeBatchProtectiveOrders(desired, false),
          );

          // 422 et non 502 : le bot lit une 5xx d'écriture comme « sort inconnu » et abandonne le passage de TOUTES les
          // paires (`mustAbortPass`) ; un refus connu appartient à sa paire.
          expect(error.getStatus()).toBe(422);
          expect(error.getResponse()).toMatchObject({
            error: 'EXCHANGE_BATCH_MODIFY_REFUSED',
          });
        },
      );

      // C'est le cas qui a fait écarter « lever dès le refus » : sans lui, la position reste sans stop.
      it('still places the missing stop when the modification of a stale take-profit is refused', async () => {
        getFrontendOpenOrdersSpy.mockResolvedValue([
          makeOrderFromSpec('101_0.5_9000_tp', assetName),
        ]);
        batchModifyOrdersSpy.mockResolvedValue(refusal);

        await expect(
          service.placeBatchProtectiveOrders(
            {
              assetName,
              isBuy,
              tp: [{ price: '9100', sz: '0.6' }], // modifie le TP 101
              sl: [{ price: '8100', sz: '0.35' }], // le stop MANQUE : à créer
            },
            false,
          ),
        ).rejects.toThrow('"sl":{"cancelled":[],"created":[201]');

        expect(placeOrderSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            order: expect.objectContaining({
              orderType: {
                trigger: expect.objectContaining({
                  tpsl: 'sl',
                  triggerPx: '8100',
                }) as unknown,
              },
            }) as unknown,
          }),
        );
      });

      it('carries on with the cancels and creations of the same plan, then fails saying what was sent', async () => {
        getFrontendOpenOrdersSpy.mockResolvedValue([
          makeOrderFromSpec('101_0.5_9000_tp', assetName),
          makeOrderFromSpec('102_0.3_8000_sl', assetName),
          makeOrderFromSpec('104_0.4_9500_tp', assetName),
        ]);
        batchModifyOrdersSpy.mockResolvedValue(refusal);

        const failure = service.placeBatchProtectiveOrders(
          {
            assetName,
            isBuy,
            tp: [{ price: '9100', sz: '0.6' }], // modifie le TP 101 ; le TP 104 est de trop
            sl: [
              { price: '7900', sz: '0.25' }, // modifie le SL 102
              { price: '7600', sz: '0.35' }, // à créer
            ],
          },
          false,
        );

        await expect(failure).rejects.toThrow('WERE sent');
        await expect(failure).rejects.toThrow('"cancelled":[104]');
        await expect(failure).rejects.toThrow('"created":[201]');
        expect(cancelOrderSpy).toHaveBeenCalledWith(
          expect.arrayContaining([{ oid: 104, asset: 7 }]),
          false,
        );
        expect(placeOrderSpy).toHaveBeenCalledTimes(1);
      });

      it('names in the message what was refused, with the raw answer', async () => {
        batchModifyOrdersSpy.mockResolvedValue(refusal);

        const failure = service.placeBatchProtectiveOrders(desired, false);

        await expect(failure).rejects.toThrow('2 protective order(s)');
        await expect(failure).rejects.toThrow(`"response":"${refusedText}"`);
      });

      it('logs the raw answer as an error before anything else of the plan is written', async () => {
        batchModifyOrdersSpy.mockResolvedValue(refusal);

        await expect(
          service.placeBatchProtectiveOrders(desired, false),
        ).rejects.toThrow();

        expect(logError).toHaveBeenCalledWith(
          expect.stringContaining(`"response":"${refusedText}"`),
        );
        expect(logError.mock.invocationCallOrder[0]).toBeLessThan(
          placeOrderSpy.mock.invocationCallOrder[0],
        );
      });

      it('keeps the refusal in the journal when a later write of the same plan throws', async () => {
        batchModifyOrdersSpy.mockResolvedValue(refusal);
        placeOrderSpy.mockRejectedValue(new Error('network down'));

        await expect(
          service.placeBatchProtectiveOrders(desired, false),
        ).rejects.toThrow('network down');

        expect(logError).toHaveBeenCalledWith(
          expect.stringContaining(`"response":"${refusedText}"`),
        );
      });

      // Ce que la doc invoque comme « le repli existe » n'avait aucun test : on le fige, car le traitement d'un lot refusé en
      // entier ne doit pas le toucher (un refus PAR ORDRE reste un repli par annulation + recréation, pas une exception).
      it('still falls back to cancel and recreate when the exchange refuses one order of the batch', async () => {
        batchModifyOrdersSpy.mockResolvedValue({
          status: 'ok',
          response: {
            data: {
              statuses: [
                { error: refusedText }, // le TP 101
                { resting: { oid: 1222 } }, // le SL 102
              ],
            },
          },
        });

        const result = await service.placeBatchProtectiveOrders(desired, false);

        expect(cancelOrderSpy).toHaveBeenCalledWith(
          [{ oid: 101, asset: 7 }],
          false,
        );
        // le TP 9200 prévu, et le TP 9100 que la modification n'a pas pu faire
        expect(placeOrderSpy).toHaveBeenCalledTimes(2);
        expect(result.tp.cancelled).toEqual([101]);
        expect(result.sl.updated).toEqual([1222]);
        expect(logError).toHaveBeenCalledWith(
          expect.stringContaining('Failed to modify order 101'),
        );
      });

      /**
       * Un `ok` dont les statuts ne se comptent pas un par modification.
       *
       * L'ordre des statuts est le SEUL lien entre une réponse et un ordre. La page des erreurs d'Hyperliquid (lue en brut le
       * 2026-10-27) dit qu'une pré-validation en échec rend UNE seule erreur pour tout le lot, que la réponse peut être
       * dupliquée n fois avant d'être remise au callback, et recommande de traiter ce cas. Avant, `if (!status) return;`
       * sautait sans un mot les modifications sans statut, et le repli par annulation + recréation ne s'appliquait qu'à la
       * première : reproduit avec un double le 2026-10-27, la modification du stop disparaissait sans trace.
       *
       * ⚠️ Cette page ne parle que des erreurs d'ordre et d'annulation : rien sur `modify`. Que l'erreur unique existe pour un
       * `batchModify`, sous quelle enveloppe (`ok` à un statut, ou `err`), et quel est le texte d'une erreur de `modify`,
       * n'est PAS mesuré : les doubles construisent la FORME (une liste trop courte ou trop longue, ou absente) avec le même
       * libellé neutre que plus haut. Ce qu'ils figent est la décision : ne rien attribuer à un ordre quand on ne peut pas
       * aligner les statuts sur les modifications.
       */
      describe('an ok answer that does not hold one status per modification', () => {
        const okWith = (statuses: unknown[]) => ({
          status: 'ok',
          response: { type: 'order', data: { statuses } },
        });
        const loneError = okWith([{ error: refusedText }]);

        it.each([
          ['one error for two modifications', loneError],
          ['an empty list of statuses', okWith([])],
          [
            'a status too many',
            okWith([
              { resting: { oid: 1111 } },
              { resting: { oid: 1222 } },
              { error: refusedText },
            ]),
          ],
          [
            'no list of statuses',
            { status: 'ok', response: { type: 'order', data: {} } },
          ],
          ['no data at all', { status: 'ok', response: { type: 'order' } }],
          ['no response at all', { status: 'ok' }],
        ])('ends with a clear refusal (422) on %s', async (_label, answer) => {
          batchModifyOrdersSpy.mockResolvedValue(answer);

          const error = await failureOf(
            service.placeBatchProtectiveOrders(desired, false),
          );

          expect(error.getStatus()).toBe(422);
          expect(error.getResponse()).toMatchObject({
            error: 'EXCHANGE_BATCH_MODIFY_UNMATCHED',
          });
        });

        // Le cas qui a fait écarter « lever dès le refus » vaut ici aussi : sans lui, la position reste sans stop.
        it('still places the missing stop when the list of statuses is short', async () => {
          getFrontendOpenOrdersSpy.mockResolvedValue([
            makeOrderFromSpec('101_0.5_9000_tp', assetName),
          ]);
          batchModifyOrdersSpy.mockResolvedValue(okWith([]));

          await expect(
            service.placeBatchProtectiveOrders(
              {
                assetName,
                isBuy,
                tp: [{ price: '9100', sz: '0.6' }], // modifie le TP 101
                sl: [{ price: '8100', sz: '0.35' }], // le stop MANQUE : à créer
              },
              false,
            ),
          ).rejects.toThrow('"sl":{"cancelled":[],"created":[201]');

          expect(placeOrderSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              order: expect.objectContaining({
                orderType: {
                  trigger: expect.objectContaining({
                    tpsl: 'sl',
                    triggerPx: '8100',
                  }) as unknown,
                },
              }) as unknown,
            }),
          );
        });

        // Un seul statut ne dit pas de QUEL ordre il parle : on ne le devine pas. L'ancien code le prenait pour celui du TP 101
        // (annulation + recréation) et laissait le stop 102 en l'état, sans un mot.
        it('does not guess which order a lone error is about: no fallback, no cancel', async () => {
          batchModifyOrdersSpy.mockResolvedValue(loneError);

          await expect(
            service.placeBatchProtectiveOrders(desired, false),
          ).rejects.toThrow();

          expect(cancelOrderSpy).not.toHaveBeenCalled();
          // la seule création du plan (le TP 9200), pas la recréation du TP 101
          expect(placeOrderSpy).toHaveBeenCalledTimes(1);
          expect(logError).not.toHaveBeenCalledWith(
            expect.stringContaining('Failed to modify order'),
          );
        });

        it('credits no modification on the strength of a status it cannot match', async () => {
          batchModifyOrdersSpy.mockResolvedValue(
            okWith([{ resting: { oid: 1111 } }]),
          );

          const error = await failureOf(
            service.placeBatchProtectiveOrders(desired, false),
          );

          // `updated` reste vide des deux côtés : le 1111 n'est attribué ni au TP ni au stop
          expect(error.message).toContain(
            '"tp":{"cancelled":[],"created":[201],"updated":[]}',
          );
          expect(error.message).toContain(
            '"sl":{"cancelled":[],"created":[],"updated":[]}',
          );
        });

        it('names the counts and the raw answer in the message', async () => {
          batchModifyOrdersSpy.mockResolvedValue(loneError);

          const failure = service.placeBatchProtectiveOrders(desired, false);

          await expect(failure).rejects.toThrow('2 protective order(s)');
          await expect(failure).rejects.toThrow('1 status(es)');
          await expect(failure).rejects.toThrow(
            `"statuses":[{"error":"${refusedText}"}]`,
          );
          await expect(failure).rejects.toThrow('WERE sent');
        });

        it('logs the raw answer as an error before anything else of the plan is written', async () => {
          batchModifyOrdersSpy.mockResolvedValue(loneError);

          await expect(
            service.placeBatchProtectiveOrders(desired, false),
          ).rejects.toThrow();

          expect(logError).toHaveBeenCalledWith(
            expect.stringContaining('cannot be matched one to one'),
          );
          expect(logError).toHaveBeenCalledWith(
            expect.stringContaining(`"statuses":[{"error":"${refusedText}"}]`),
          );
          expect(logError.mock.invocationCallOrder[0]).toBeLessThan(
            placeOrderSpy.mock.invocationCallOrder[0],
          );
        });

        // La frontière : un lot d'UNE modification n'a droit qu'à UN statut, et celui-là est bien le sien. Une erreur de
        // pré-validation de tout le lot est alors indiscernable d'un refus de cet ordre : le repli par ordre s'applique, comme
        // pour tout refus par ordre (voir plus haut).
        it('still reads the only status of a one-modification batch as its own', async () => {
          getFrontendOpenOrdersSpy.mockResolvedValue([
            makeOrderFromSpec('101_0.5_9000_tp', assetName),
          ]);
          batchModifyOrdersSpy.mockResolvedValue(
            okWith([{ error: refusedText }]),
          );

          const result = await service.placeBatchProtectiveOrders(
            { assetName, isBuy, tp: [{ price: '9100', sz: '0.6' }], sl: [] },
            false,
          );

          expect(cancelOrderSpy).toHaveBeenCalledWith(
            [{ oid: 101, asset: 7 }],
            false,
          );
          expect(result.tp.cancelled).toEqual([101]);
          expect(result.tp.created).toEqual([201]);
        });
      });
    });
  });

  /**
   * Le prix limite `p` d'un ordre protecteur AU MARCHÉ : la borne que l'exchange recalcule lui-même
   * (déclencheur × 0,9 pour une vente, × 1,1 pour un achat ; un achat tronqué, une vente tronquée
   * puis relevée d'un tick) et dont il ignore le `p` qu'on lui envoie — mesuré le 2026-10-18, voir
   * `MARKET_TRIGGER_LIMIT_FACTOR` et docs/protective-order-price.md. Les valeurs sont écrites en
   * clair, pas relues depuis la constante : un test qui la relirait dirait toujours la même chose
   * qu'elle.
   */
  describe('toHLOrderDetails — limit price of a protective order', () => {
    const protective = (
      overrides: Partial<Parameters<SmartOrderService['toHLOrderDetails']>[0]>,
    ) =>
      service.toHLOrderDetails({
        assetName: 'BTC',
        kind: 'sl',
        isBuy: false,
        sz: '0.01',
        price: '81000',
        ...overrides,
      });

    beforeEach(() => {
      getSzDecimals.mockReturnValue(5); // BTC
      isPerp.mockReturnValue(true);
    });

    it('puts a market stop that sells 10 % under its trigger', () => {
      expect(protective({ isBuy: false }).limitPx).toBe('72901');
    });

    it('puts a market stop that buys 10 % over its trigger', () => {
      expect(protective({ isBuy: true, price: '81000' }).limitPx).toBe('89100');
    });

    it('gives a market take profit the same spread as a stop', () => {
      expect(protective({ kind: 'tp', isBuy: false }).limitPx).toBe('72901');
    });

    it('treats a missing isMarket as market, as the trigger itself does', () => {
      const order = protective({ isMarket: undefined });
      expect(order.orderType).toEqual({
        trigger: { isMarket: true, triggerPx: '81000', tpsl: 'sl' },
      });
      expect(order.limitPx).toBe('72901');
    });

    it('leaves the trigger itself untouched: only the limit moves', () => {
      const order = protective({});
      expect(order.orderType).toMatchObject({
        trigger: { triggerPx: '81000' },
      });
    });

    it('keeps p equal to the trigger for a limit trigger: the caller gave one price only', () => {
      const order = protective({ isMarket: false });
      expect(order.limitPx).toBe('81000');
      expect(order.orderType).toMatchObject({ trigger: { isMarket: false } });
    });

    // Le gateway est une passerelle : il ne refuse pas ce que l'exchange accepte. Mais un limite
    // égal au déclencheur est le cas MESURÉ qui reste au carnet (Stop Limit ETH, 826 secondes,
    // 2026-10-18) : il se dit, en avertissement de journal, et l'ordre part tel quel.
    describe('a limit trigger is signalled, not refused', () => {
      let warn: jest.SpyInstance;

      beforeEach(() => {
        warn = jest
          .spyOn(
            (service as unknown as { logger: { warn: () => void } }).logger,
            'warn',
          )
          .mockImplementation(() => undefined);
      });

      it('warns, naming the asset, the kind and the limit that equals the trigger', () => {
        protective({ isMarket: false, kind: 'sl', price: '81000' });

        expect(warn).toHaveBeenCalledTimes(1);
        const [firstCall] = warn.mock.calls as unknown[][];
        const message = String(firstCall[0]);
        expect(message).toContain('[BTC]');
        expect(message).toContain('SL');
        expect(message).toContain('isMarket: false');
        expect(message).toContain('81000');
        expect(message).toContain('docs/protective-order-price.md');
      });

      it('still sends the order as asked: nothing is refused or changed', () => {
        const order = protective({ isMarket: false, price: '81000' });

        expect(order.limitPx).toBe('81000');
        expect(order.reduceOnly).toBe(true);
      });

      it('says nothing for a market trigger, the default and the bot case', () => {
        protective({ isMarket: true });
        protective({ isMarket: undefined });

        expect(warn).not.toHaveBeenCalled();
      });
    });

    it('truncates a buy, and raises a sell by one tick after truncating it, as the exchange does', () => {
      // 81234 × 0,9 = 73110,6 → tronqué 73110, plus un tick : 73111.
      expect(protective({ price: '81234' }).limitPx).toBe('73111');
      // 81238 × 1,1 = 89361,8 → tronqué : 89361.
      expect(protective({ price: '81238', isBuy: true }).limitPx).toBe('89361');
      // 81838 × 0,9 = 73654,2 : l'exchange écrit 73655, pas 73654.
      expect(protective({ price: '81838' }).limitPx).toBe('73655');
    });

    it('raises a sell by one tick even when the product is exact, and leaves an exact buy alone', () => {
      // Les deux produits exacts de l'historique du compte (2026-10-18), recopiés.
      expect(protective({ price: '78130' }).limitPx).toBe('70318');
      expect(protective({ price: '79960', isBuy: true }).limitPx).toBe('87956');
    });

    /**
     * Des ordres déclenchés RÉELS, relevés dans `historicalOrders` du compte le 2026-10-18 : le
     * `limitPx` de la ligne `filled`, écrit par l'exchange, recopié. Si l'un tombe, notre `p` s'est
     * écarté de la borne qu'il applique.
     */
    it.each([
      ['BTC sell', 'BTC', 5, '81838', false, '73655'],
      ['BTC sell', 'BTC', 5, '81937', false, '73744'],
      ['BTC sell', 'BTC', 5, '78009', false, '70209'],
      ['BTC buy', 'BTC', 5, '77724', true, '85496'],
      ['BTC buy', 'BTC', 5, '77761', true, '85537'],
      ['BTC buy', 'BTC', 5, '78373', true, '86210'],
      ['SOL sell', 'SOL', 2, '85.014', false, '76.513'],
      ['SOL sell', 'SOL', 2, '85.347', false, '76.813'],
      ['SOL buy', 'SOL', 2, '82.717', true, '90.988'],
      ['SOL buy', 'SOL', 2, '84.329', true, '92.761'],
    ])(
      'writes what the exchange wrote on a triggered market order: %s %s',
      (_label, assetName, szDecimals, price, isBuy, expected) => {
        getSzDecimals.mockReturnValue(szDecimals);
        expect(protective({ assetName, price, isBuy }).limitPx).toBe(expected);
      },
    );

    it('does the arithmetic exactly: no floating point noise decides the last digit', () => {
      // 129,2 × 0,9 = 116,28 : tronqué 116.28, plus un tick, 116.29. Un produit flottant
      // 116,27999999999999 serait tronqué à 116.27, plus un tick, 116.28 : un tick de travers.
      getSzDecimals.mockReturnValue(2);
      expect(protective({ price: '129.2' }).limitPx).toBe('116.29');
      expect(protective({ price: '129.7', isBuy: true }).limitPx).toBe(
        '142.67',
      );
    });

    it('applies the spot decimals rule to a spot market', () => {
      getSzDecimals.mockReturnValue(2);
      isPerp.mockReturnValue(false);
      // Spot : jusqu'à 8 − szDecimals = 6 décimales, 5 chiffres significatifs au plus.
      // 0,123456 × 0,9 = 0,1111104 → 0,11111 ; vers le haut (vente) : 0,11112.
      expect(
        protective({ assetName: 'PURR/USDC', price: '0.123456' }).limitPx,
      ).toBe('0.11112');
    });

    it('refuses an unknown asset rather than guessing decimals', () => {
      getSzDecimals.mockReturnValue(undefined);
      expect(() => protective({ assetName: 'NOPE' })).toThrow(
        /Unknown szDecimals for: NOPE/,
      );
    });

    it('never fails silently when the price is not a plain decimal', () => {
      expect(() => protective({ price: 'abc' })).toThrow();
    });
  });

  describe('filterUnchangedOrders', () => {
    const assetName = 'ETH';
    const existing: ExistingProtectiveOrder[] = [
      { oid: 100, price: '3000', sz: '1.5', kind: 'tp', isMarket: true },
    ];

    // Ces tests ne déclaraient aucune grille : ils passaient par le repli `?? 6`, c'est-à-dire sur un
    // mensonge. ETH a `szDecimals` 4 sur l'exchange.
    beforeEach(() => {
      getSzDecimals.mockReturnValue(4);
      isPerp.mockReturnValue(true);
    });

    const createBaseModList = (
      sz: string,
      price: string,
      tpsl: 'tp' | 'sl',
      isMarket: boolean,
    ): HLModifyInput[] => [
      {
        oid: 100,
        order: {
          assetName,
          isBuy: true,
          reduceOnly: true,
          sz,
          limitPx: price,
          orderType: {
            trigger: { triggerPx: price, isMarket, tpsl },
          },
        },
      } as HLModifyInput,
    ];

    it('should return empty when price, size, tpsl and isMarket are identical', () => {
      const modList = createBaseModList('1.500', '3000', 'tp', true);
      const result = service['filterUnchangedOrders']({
        modList,
        existing,
        assetName,
      });
      expect(result).toHaveLength(0);
    });

    it('should return the order when only size is different', () => {
      const modList = createBaseModList('1.6', '3000', 'tp', true);
      const result = service['filterUnchangedOrders']({
        modList,
        existing,
        assetName,
      });
      expect(result).toHaveLength(1);
    });

    it('should return the order when only price is different', () => {
      const modList = createBaseModList('1.5', '3005', 'tp', true);
      const result = service['filterUnchangedOrders']({
        modList,
        existing,
        assetName,
      });
      expect(result).toHaveLength(1);
    });

    it('should return the order when both price and size are different', () => {
      const modList = createBaseModList('2.0', '3100', 'tp', true);
      const result = service['filterUnchangedOrders']({
        modList,
        existing,
        assetName,
      });
      expect(result).toHaveLength(1);
    });

    it('should return the order when only TPSL is different', () => {
      const modList = createBaseModList('1.5', '3000', 'sl', true);
      const result = service['filterUnchangedOrders']({
        modList,
        existing,
        assetName,
      });
      expect(result).toHaveLength(1);
    });

    it('should return the order when only isMarket is different', () => {
      const modList = createBaseModList('1.5', '3000', 'tp', false);
      const result = service['filterUnchangedOrders']({
        modList,
        existing,
        assetName,
      });
      expect(result).toHaveLength(1);
    });

    // Il formatait sur 6 décimales un actif inconnu du registre : une taille `1.5678` sur un actif de grille 2
    // se comparait comme telle, donc « changée » ou « inchangée » à tort. La demande, elle, doit être exacte.
    it('refuses an asset whose grid the registry does not know, instead of formatting on 6 decimals', () => {
      getSzDecimals.mockReturnValue(undefined);
      const modList = createBaseModList('1.5', '3000', 'tp', true);

      expect(() =>
        service['filterUnchangedOrders']({ modList, existing, assetName }),
      ).toThrow(/Unknown szDecimals for: ETH/);
    });
  });

  // Les ordres que l'exchange détient sont valides par construction : leur écriture canonique ne peut rien perdre.
  // Sans grille connue on ne devine pas : on les compare tels quels, et on le dit.
  describe('canonicalOrRaw', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
    });

    afterEach(() => warnSpy.mockRestore());

    it('writes a value the way the request will, on the grid of its own asset', () => {
      getSzDecimals.mockReturnValue(2);
      isPerp.mockReturnValue(true);

      // L'exchange rend `1103.0` quand `formatPrice` écrit `1103` : la même valeur, deux écritures.
      expect(service['canonicalOrRaw']('1103.0', 'SOL', 'price')).toBe('1103');
      expect(service['canonicalOrRaw']('1.960', 'SOL', 'size')).toBe('1.96');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('keeps the raw value, and says so, when the registry does not know the grid', () => {
      getSzDecimals.mockReturnValue(undefined);

      expect(service['canonicalOrRaw']('1103.0', 'NOPE', 'price')).toBe(
        '1103.0',
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[NOPE] szDecimals unknown to the registry: existing protective price 1103.0 is compared raw',
        ),
      );
    });

    // `?? 6` aurait réécrit `1.500` en `1.5` sur une grille inventée : l'écriture de l'exchange n'est pas la nôtre
    // à corriger. Le brut reste le brut.
    it('does not rewrite a size on a guessed grid', () => {
      getSzDecimals.mockReturnValue(undefined);

      expect(service['canonicalOrRaw']('1.500', 'NOPE', 'size')).toBe('1.500');
    });
  });
});
