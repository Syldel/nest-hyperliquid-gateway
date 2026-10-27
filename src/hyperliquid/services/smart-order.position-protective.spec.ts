import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { SmartOrderService } from './smart-order.service';
import { HyperliquidApiPrivateInfoService } from './hyperliquid-api-private-info.service';
import { HyperliquidApiPublicInfoService } from './hyperliquid-api-public-info.service';
import { HyperliquidApiTradeService } from './hyperliquid-api-trade.service';
import { DecimalUtilsService } from '../utils/decimal-utils.service';
import { PriceMathService } from './price-math.service';
import { AssetRegistryService } from './asset-registry.service';
import { ValueFormatterService } from './value-formatter.service';
import { HyperliquidCollateralService } from './hyperliquid-collateral.service';
import { HLProtectiveKind } from '../dtos/protective-order.dtos';
import { PositionLevelOrder } from '../utils/position-level-order';

/**
 * Les TP/SL « de position » vus du service intelligent : la borne du déclencheur au marché, le côté de la clôture, et la
 * lecture du statut. Le fil lui-même est éprouvé dans `hyperliquid-api-trade.service.spec.ts`.
 */
describe('SmartOrderService — position-level protective orders', () => {
  let service: SmartOrderService;
  let placePositionLevelOrder: jest.Mock;
  let modifyPositionLevelOrder: jest.Mock;
  let getSzDecimals: jest.Mock;

  /** Le premier appel au service de fil, typé : ce que `placePositionLevelOrder` a reçu. */
  const placedOrder = () =>
    (
      placePositionLevelOrder.mock.calls as [
        { order: PositionLevelOrder; isTestnet: boolean },
      ][]
    )[0][0];

  const accepted = (status: unknown = { resting: { oid: 7 } }) => ({
    status: 'ok',
    response: { type: 'order', data: { statuses: [status] } },
  });

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    placePositionLevelOrder = jest.fn().mockResolvedValue(accepted());
    modifyPositionLevelOrder = jest.fn().mockResolvedValue(accepted());
    getSzDecimals = jest.fn().mockReturnValue(4);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmartOrderService,
        { provide: HyperliquidApiPrivateInfoService, useValue: {} },
        { provide: HyperliquidApiPublicInfoService, useValue: {} },
        {
          provide: HyperliquidApiTradeService,
          useValue: { placePositionLevelOrder, modifyPositionLevelOrder },
        },
        DecimalUtilsService,
        PriceMathService,
        {
          provide: AssetRegistryService,
          useValue: { getSzDecimals, isPerp: jest.fn().mockReturnValue(true) },
        },
        ValueFormatterService,
        { provide: HyperliquidCollateralService, useValue: {} },
      ],
    }).compile();

    service = module.get(SmartOrderService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const sellStop = {
    assetName: 'ETH',
    kind: HLProtectiveKind.SL,
    isBuy: false,
    price: '2307.2',
  };

  it('closes a long by selling, with the exchange bound of a market trigger as its limit', async () => {
    await service.placePositionProtectiveOrder(sellStop);

    // 2307,2 × 0,9 = 2076,48 ; tronqué à 2076,4 puis relevé d'un tick pour une vente (règle mesurée du gateway).
    expect(placePositionLevelOrder).toHaveBeenCalledWith({
      order: {
        assetName: 'ETH',
        isBuy: false,
        limitPx: '2076.5',
        triggerPx: '2307.2',
        tpsl: 'sl',
      },
      isTestnet: false,
    });
  });

  it('closes a short by buying, bound 10 % above, truncated', async () => {
    await service.placePositionProtectiveOrder({
      ...sellStop,
      isBuy: true,
      price: '2316.0',
    });

    // 2316 × 1,1 = 2547,6.
    expect(placedOrder().order).toMatchObject({
      isBuy: true,
      limitPx: '2547.6',
      triggerPx: '2316.0',
    });
  });

  it('keeps a take-profit a take-profit', async () => {
    await service.placePositionProtectiveOrder({
      ...sellStop,
      kind: HLProtectiveKind.TP,
      price: '2356.0',
    });

    expect(placedOrder().order.tpsl).toBe('tp');
  });

  it('passes the testnet flag on', async () => {
    await service.placePositionProtectiveOrder(sellStop, true);

    expect(placedOrder().isTestnet).toBe(true);
  });

  it('hands the exchange answer back when the order is accepted', async () => {
    const answer = accepted({ resting: { oid: 586700000001 } });
    placePositionLevelOrder.mockResolvedValue(answer);

    await expect(service.placePositionProtectiveOrder(sellStop)).resolves.toBe(
      answer,
    );
  });

  // MESURÉ le 2026-10-27, premier stop de position créé par ce gateway : le statut est cette chaîne, sans oid. Le premier jet
  // lisait `'error' in status` dessus, levait un TypeError et renvoyait un 500 alors que l'ordre était posé. L'enveloppe
  // autour de la chaîne n'a pas été capturée entière (le gateway a levé avant de la journaliser) : elle est celle que le
  // code lisait, `response.response.data.statuses[0]`.
  it('accepts the string status the exchange answers to a position-level order, which carries no oid', async () => {
    const answer = accepted('waitingForTrigger');
    placePositionLevelOrder.mockResolvedValue(answer);

    await expect(service.placePositionProtectiveOrder(sellStop)).resolves.toBe(
      answer,
    );
  });

  it('refuses a string status it does not know, with the raw answer and the warning that the order may exist', async () => {
    placePositionLevelOrder.mockResolvedValue(accepted('waitingForFill'));

    const refusal = service.placePositionProtectiveOrder(sellStop);

    await expect(refusal).rejects.toThrow('waitingForFill');
    await expect(refusal).rejects.toThrow('may have been placed');
  });

  it('refuses an answer that is neither a status nor the exchange generic ack, with the raw answer', async () => {
    placePositionLevelOrder.mockResolvedValue({
      status: 'ok',
      response: { type: 'surprise' },
    });

    await expect(
      service.placePositionProtectiveOrder(sellStop),
    ).rejects.toThrow('"type":"surprise"');
  });

  // MESURÉ le 2026-10-27, deux fois (journal du gateway) : c'est exactement la réponse de l'exchange à la modification d'un
  // stop de position, sans statut d'ordre ni oid. Le nouvel oid ne se lit que dans les ordres ouverts.
  it('accepts the generic ack the exchange answers to a modification, which carries no oid', async () => {
    const ack = { status: 'ok', response: { type: 'default' } };
    modifyPositionLevelOrder.mockResolvedValue(ack);

    await expect(
      service.modifyPositionProtectiveOrder(1, sellStop),
    ).resolves.toBe(ack);
  });

  it('turns an exchange error into a gateway error that says what the exchange said', async () => {
    placePositionLevelOrder.mockResolvedValue(
      accepted({ error: 'Order has zero size.' }),
    );

    await expect(
      service.placePositionProtectiveOrder(sellStop),
    ).rejects.toThrow('Hyperliquid execution error: Order has zero size.');
  });

  it('refuses an answer without any status', async () => {
    placePositionLevelOrder.mockResolvedValue({
      status: 'ok',
      response: { type: 'order', data: { statuses: [] } },
    });

    await expect(
      service.placePositionProtectiveOrder(sellStop),
    ).rejects.toThrow('No order status returned');
  });

  it('refuses an asset whose size grid is unknown, before anything is sent', async () => {
    getSzDecimals.mockReturnValue(undefined);

    await expect(
      service.placePositionProtectiveOrder(sellStop),
    ).rejects.toThrow('Unknown szDecimals');
    expect(placePositionLevelOrder).not.toHaveBeenCalled();
  });

  it('modifies an order by its oid, with the same shape', async () => {
    await service.modifyPositionProtectiveOrder(586699627884, {
      ...sellStop,
      price: '2300.0',
    });

    expect(modifyPositionLevelOrder).toHaveBeenCalledWith(
      586699627884,
      expect.objectContaining({
        isBuy: false,
        triggerPx: '2300.0',
        tpsl: 'sl',
      }),
      false,
    );
    expect(placePositionLevelOrder).not.toHaveBeenCalled();
  });

  it('reads the status of a modification as strictly as that of a placement', async () => {
    modifyPositionLevelOrder.mockResolvedValue(
      accepted({ error: 'Cannot modify this order' }),
    );

    await expect(
      service.modifyPositionProtectiveOrder(1, sellStop),
    ).rejects.toThrow('Hyperliquid execution error: Cannot modify this order');
  });
});
