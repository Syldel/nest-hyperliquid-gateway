import type { CollateralBalance } from '@syldel/hl-shared-types';
import { HyperliquidInfoController } from './hyperliquid-info.controller';

/**
 * La route `collateral-balance` ajoute `asset` au résultat du service. Mesuré sur
 * un `ok` le 2026-10-18 (capture réelle du bot, ETH, compte unifié) : `asset` y
 * est la première clé. Les trois autres statuts le portent par lecture du
 * contrôleur — c'est ce que ces tests figent.
 */
describe('HyperliquidInfoController.getCollateralBalance', () => {
  const answering = (balance: CollateralBalance) => {
    const getCollateralBalance = jest.fn().mockResolvedValue(balance);
    const controller = new HyperliquidInfoController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getCollateralBalance } as never,
    );
    return { controller, getCollateralBalance };
  };

  it('puts the queried asset in front of an ok answer, as the real route did', async () => {
    const { controller } = answering({
      status: 'ok',
      mode: 'unifiedAccount',
      collateral: 'USDC',
      collateralToken: 0,
      total: '24.73757982',
      used: '0.0',
    });

    const body = await controller.getCollateralBalance('ETH');

    expect(Object.keys(body)).toEqual([
      'asset',
      'status',
      'mode',
      'collateral',
      'collateralToken',
      'total',
      'used',
    ]);
    expect(body.asset).toBe('ETH');
  });

  // Le service ne rend plus `asset` : sans cet ajout, ces deux statuts, qui le
  // portaient avant le 2026-10-19, le perdraient sur le fil.
  it.each([
    ['unknown-collateral', 'NOPE'],
    ['unsupported-mode', 'BTC'],
  ] as const)(
    'echoes the asset on a %s answer, which the service no longer carries',
    async (status, asset) => {
      const { controller } = answering({
        status,
        mode: 'unifiedAccount',
      });

      const body = await controller.getCollateralBalance(asset);

      expect(Object.keys(body)).toEqual(['asset', 'status', 'mode']);
      expect(body.asset).toBe(asset);
    },
  );

  it('echoes the asset on a no-balance-entry answer too', async () => {
    const { controller } = answering({
      status: 'no-balance-entry',
      mode: 'unifiedAccount',
      collateral: 'USDC',
      collateralToken: 0,
    });

    await expect(controller.getCollateralBalance('ETH')).resolves.toMatchObject(
      { asset: 'ETH', status: 'no-balance-entry' },
    );
  });

  it('passes the asset and the explicit collateral on to the service untouched', async () => {
    const { controller, getCollateralBalance } = answering({
      status: 'unknown-collateral',
      mode: 'unifiedAccount',
    });

    await controller.getCollateralBalance('cash:TSLA', 'usdt');

    expect(getCollateralBalance).toHaveBeenCalledWith('cash:TSLA', 'usdt');
  });
});
