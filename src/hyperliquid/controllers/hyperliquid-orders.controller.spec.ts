import { HyperliquidOrdersController } from './hyperliquid-orders.controller';

describe('HyperliquidOrdersController.getHistoricalOrders', () => {
  it('hands the records of the service back untouched', async () => {
    const records = [
      { order: { oid: 1 }, status: 'filled', statusTimestamp: 1 },
      { order: { oid: 1 }, status: 'open', statusTimestamp: 0 },
    ];
    const getHistoricalOrders = jest.fn().mockResolvedValue(records);
    const controller = new HyperliquidOrdersController({
      getHistoricalOrders,
    } as never);

    const body = await controller.getHistoricalOrders({});

    expect(body).toBe(records);
    expect(getHistoricalOrders).toHaveBeenCalledWith(undefined);
  });

  it('passes the testnet flag on', async () => {
    const getHistoricalOrders = jest.fn().mockResolvedValue([]);
    const controller = new HyperliquidOrdersController({
      getHistoricalOrders,
    } as never);

    await controller.getHistoricalOrders({ isTestnet: true });

    expect(getHistoricalOrders).toHaveBeenCalledWith(true);
  });
});
