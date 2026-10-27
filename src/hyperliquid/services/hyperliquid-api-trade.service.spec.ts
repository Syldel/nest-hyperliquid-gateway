import { HyperliquidApiTradeService } from './hyperliquid-api-trade.service';
import { ValueFormatterService } from './value-formatter.service';
import { PositionLevelOrder } from '../utils/position-level-order';

type Sent = {
  endpoint: string;
  action: Record<string, unknown>;
  isTestnet: unknown;
};

/**
 * Ce que le service envoie à Hyperliquid, relevé là où l'action part (`executeWithNonce`), après toute conversion :
 * c'est le fil, pas l'intention de l'appelant.
 */
function serviceThatRecords(
  registry: {
    assetId?: number | undefined;
    szDecimals?: number | undefined;
    isPerp?: boolean;
  } = {},
) {
  const assetRegistry = {
    getAssetId: jest
      .fn()
      .mockReturnValue('assetId' in registry ? registry.assetId : 1),
    getSzDecimals: jest
      .fn()
      .mockReturnValue('szDecimals' in registry ? registry.szDecimals : 4),
    isPerpById: jest.fn().mockReturnValue(registry.isPerp ?? true),
  };
  const service = new HyperliquidApiTradeService(
    {} as never,
    {} as never,
    {} as never,
    new ValueFormatterService(),
    assetRegistry as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const sent: Sent[] = [];
  jest
    .spyOn(
      service as unknown as {
        executeWithNonce: (...args: unknown[]) => Promise<unknown>;
      },
      'executeWithNonce',
    )
    .mockImplementation(
      (endpoint: unknown, action: unknown, isTestnet: unknown) => {
        sent.push({
          endpoint: endpoint as string,
          action: action as Record<string, unknown>,
          isTestnet,
        });
        return Promise.resolve({ status: 'ok' });
      },
    );

  return { service, sent };
}

/** Le stop de position du test du 2026-10-26 : déclencheur 2307,2, borne de 10 % à 2076,5. */
const positionStop: PositionLevelOrder = {
  assetName: 'ETH',
  isBuy: false,
  limitPx: '2076.5',
  triggerPx: '2307.2',
  tpsl: 'sl',
};

const wire = (overrides: Record<string, unknown> = {}) => ({
  a: 1,
  b: false,
  p: '2076.5',
  s: '0',
  r: true,
  t: { trigger: { isMarket: true, triggerPx: '2307.2', tpsl: 'sl' } },
  ...overrides,
});

describe('HyperliquidApiTradeService — position-level orders on the wire', () => {
  it('writes a position-level stop with a size of "0", reduce-only, in the "positionTpsl" group', async () => {
    const { service, sent } = serviceThatRecords();

    await service.placePositionLevelOrder({ order: positionStop });

    expect(sent).toEqual([
      {
        endpoint: 'exchange',
        action: {
          type: 'order',
          orders: [wire()],
          grouping: 'positionTpsl',
        },
        isTestnet: false,
      },
    ]);
  });

  it('closes a short by buying, and keeps a take-profit a take-profit', async () => {
    const { service, sent } = serviceThatRecords();

    await service.placePositionLevelOrder({
      order: {
        ...positionStop,
        isBuy: true,
        tpsl: 'tp',
        limitPx: '2537.9',
        triggerPx: '2307.2',
      },
    });

    const orders = (sent[0].action as { orders: unknown[] }).orders;
    expect(orders).toEqual([
      wire({
        b: true,
        p: '2537.9',
        t: { trigger: { isMarket: true, triggerPx: '2307.2', tpsl: 'tp' } },
      }),
    ]);
  });

  it('passes the testnet flag on', async () => {
    const { service, sent } = serviceThatRecords();

    await service.placePositionLevelOrder({
      order: positionStop,
      isTestnet: true,
    });

    expect(sent[0].isTestnet).toBe(true);
  });

  it('writes a modified position-level order with the same "0" size, and no group', async () => {
    const { service, sent } = serviceThatRecords();

    await service.modifyPositionLevelOrder(586699627884, positionStop);

    expect(sent).toEqual([
      {
        endpoint: 'exchange',
        action: { type: 'modify', oid: 586699627884, order: wire() },
        isTestnet: false,
      },
    ]);
  });

  it('refuses an unknown asset, and sends nothing', async () => {
    const { service, sent } = serviceThatRecords({ assetId: undefined });

    await expect(
      service.placePositionLevelOrder({ order: positionStop }),
    ).rejects.toThrow('Unknown asset: ETH');
    expect(sent).toEqual([]);
  });

  it('refuses an asset whose size grid is unknown, and sends nothing', async () => {
    const { service, sent } = serviceThatRecords({ szDecimals: undefined });

    await expect(
      service.placePositionLevelOrder({ order: positionStop }),
    ).rejects.toThrow('Unknown szDecimals');
    expect(sent).toEqual([]);
  });

  // Une position n'existe que sur un perpétuel : sur un spot, l'ordre n'a pas de sens.
  it('refuses a market that is not a perpetual, and sends nothing', async () => {
    const { service, sent } = serviceThatRecords({ isPerp: false });

    await expect(
      service.placePositionLevelOrder({ order: positionStop }),
    ).rejects.toThrow('only exists on a perpetual');
    expect(sent).toEqual([]);
  });

  it('refuses a trigger price that truncates to zero, and sends nothing', async () => {
    const { service, sent } = serviceThatRecords();

    await expect(
      service.placePositionLevelOrder({
        order: { ...positionStop, triggerPx: '0' },
      }),
    ).rejects.toThrow('too small');
    expect(sent).toEqual([]);
  });
});

/**
 * L'invariant que cette famille n'a pas le droit de desserrer : le chemin des ordres ordinaires. Sa garde contre une
 * taille de zéro est ancienne et voulue (`formatSize`), et l'ordre de position, lui, n'a pas de taille à lui faire
 * tolérer.
 */
describe('HyperliquidApiTradeService — the ordinary path is as it was', () => {
  const ordinaryStop = {
    assetName: 'ETH',
    isBuy: false,
    limitPx: '2076.5',
    sz: '0.006',
    reduceOnly: true,
    orderType: {
      trigger: {
        isMarket: true,
        triggerPx: '2307.2',
        tpsl: 'sl' as const,
      },
    },
  };

  it('still formats the size of an ordinary order', async () => {
    const { service, sent } = serviceThatRecords();

    await service.placeOrder({ order: ordinaryStop });

    const action = sent[0].action as {
      orders: { s: string }[];
      grouping: string;
    };
    expect(action.orders[0].s).toBe('0.006');
    expect(action.grouping).toBe('na');
  });

  it('still refuses a size of zero, even from a reduce-only trigger in the "positionTpsl" group', async () => {
    const { service, sent } = serviceThatRecords();

    await expect(
      service.placeOrder({
        order: { ...ordinaryStop, sz: '0' },
        grouping: 'positionTpsl',
      }),
    ).rejects.toThrow('Size is too small');
    expect(sent).toEqual([]);
  });

  it('still refuses a size that truncates to zero', async () => {
    const { service, sent } = serviceThatRecords();

    await expect(
      service.placeOrder({ order: { ...ordinaryStop, sz: '0.00001' } }),
    ).rejects.toThrow('Size is too small');
    expect(sent).toEqual([]);
  });
});
