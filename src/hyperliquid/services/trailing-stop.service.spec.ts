import {
  HttpException,
  HttpStatus,
  PreconditionFailedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AssetRegistryService } from './asset-registry.service';
import { HyperliquidApiTradeService } from './hyperliquid-api-trade.service';
import { HyperliquidApiPublicInfoService } from './hyperliquid-api-public-info.service';
import {
  TrailingStopParams,
  TrailingStopService,
} from './trailing-stop.service';

/**
 * Le registre est doublé avec les valeurs du dex principal (`ETH` → asset 1,
 * `szDecimals` 4). La réponse de succès est celle de la doc, non mesurée ; le
 * refus a la forme `{ status: 'err', response }`, lue sur d'autres actions.
 */

const ETH_STOP: TrailingStopParams = {
  assetName: 'ETH',
  isBuy: false,
  sz: '0.0065',
  reduceOnly: true,
  retracement: { pct: '10' },
};

const ASSETS: Record<string, { id: number; szDecimals: number }> = {
  ETH: { id: 1, szDecimals: 4 },
};

/** Le marqué d'ETH lors de S4, le 2026-11-17. */
const ETH_MARK = '1809.9';

async function setup(
  placeTrailingStop: jest.Mock,
  getPerpMarketsWithPrices: jest.Mock = jest
    .fn()
    .mockResolvedValue([{ name: 'ETH', markPrice: ETH_MARK }]),
) {
  const module = await Test.createTestingModule({
    providers: [
      TrailingStopService,
      { provide: HyperliquidApiTradeService, useValue: { placeTrailingStop } },
      {
        provide: HyperliquidApiPublicInfoService,
        useValue: { getPerpMarketsWithPrices },
      },
      {
        provide: AssetRegistryService,
        useValue: {
          getAssetId: (name: string) => ASSETS[name]?.id,
          getSzDecimals: (name: string) => ASSETS[name]?.szDecimals,
          isPerpById: (id: number) => id >= 0 && id < 10_000,
        },
      },
    ],
  }).compile();
  return module.get(TrailingStopService);
}

/** Le corps d'erreur d'une exception Nest, pour lire son code. */
async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return {
        status: error.getStatus(),
        ...(error.getResponse() as { error: string; message: string }),
      };
    }
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('TrailingStopService', () => {
  it('returns the oid and the action exactly as it was signed', async () => {
    const place = jest.fn().mockResolvedValue({
      status: 'ok',
      response: { type: 'trailingStop', data: { oid: 77738308 } },
    });
    const service = await setup(place);

    const placed = await service.placeTrailingStop(ETH_STOP);

    expect(placed).toEqual({
      oid: 77738308,
      action: {
        type: 'trailingStop',
        asset: 1,
        isBuy: false,
        sz: '0.0065',
        reduceOnly: true,
        retracement: { pct: '10.0000%' },
        activationPx: null,
      },
    });
    expect(place).toHaveBeenCalledTimes(1);
    expect(place).toHaveBeenCalledWith(placed.action, false);
  });

  describe('signs nothing for a market it does not place on', () => {
    it.each([
      ['a spot pair', 'PURR/USDC'],
      ['a spot pair by index', '@107'],
      ['a builder-deployed perp', 'xyz:TSLA'],
      ['an outcome', '#10'],
    ])('%s', async (_label, assetName) => {
      const place = jest.fn();
      const service = await setup(place);

      const refused = await rejection(
        service.placeTrailingStop({ ...ETH_STOP, assetName }),
      );

      expect(refused).toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        error: 'TRAILING_STOP_MARKET_UNSUPPORTED',
      });
      expect(place).not.toHaveBeenCalled();
    });

    it('an unknown asset', async () => {
      const place = jest.fn();
      const service = await setup(place);

      const refused = await rejection(
        service.placeTrailingStop({ ...ETH_STOP, assetName: 'NOPE' }),
      );

      expect(refused).toMatchObject({ status: 400, error: 'UNKNOWN_ASSET' });
      expect(place).not.toHaveBeenCalled();
    });
  });

  it('signs nothing for a size off the grid, and says so', async () => {
    const place = jest.fn();
    const service = await setup(place);

    const refused = await rejection(
      service.placeTrailingStop({ ...ETH_STOP, sz: '0.00655' }),
    );

    expect(refused).toMatchObject({
      status: 400,
      error: 'TRAILING_STOP_INVALID',
    });
    expect(refused.message).toContain('nearest size below is 0.0065');
    expect(place).not.toHaveBeenCalled();
  });

  describe('the activation side', () => {
    const placed = () =>
      jest.fn().mockResolvedValue({
        status: 'ok',
        response: { type: 'trailingStop', data: { oid: 1 } },
      });

    // Le cas mesuré : l'exchange l'a accepté et a suivi tout de suite.
    it('signs nothing for a sell activating below the mark', async () => {
      const place = placed();
      const service = await setup(place);

      const refused = await rejection(
        service.placeTrailingStop({ ...ETH_STOP, activationPx: '1719.4' }),
      );

      expect(refused).toMatchObject({
        status: 400,
        error: 'TRAILING_STOP_ACTIVATION_WRONG_SIDE',
      });
      expect(refused.message).toContain('not above the mark 1809.9');
      expect(place).not.toHaveBeenCalled();
    });

    it('signs nothing for a buy activating above the mark', async () => {
      const place = placed();
      const service = await setup(place);

      const refused = await rejection(
        service.placeTrailingStop({
          ...ETH_STOP,
          isBuy: true,
          activationPx: '1900',
        }),
      );

      expect(refused.error).toBe('TRAILING_STOP_ACTIVATION_WRONG_SIDE');
      expect(place).not.toHaveBeenCalled();
    });

    // Une activation au marqué n'attend rien : elle suivrait tout de suite.
    it('signs nothing for an activation at the mark', async () => {
      const place = placed();
      const service = await setup(place);

      await rejection(
        service.placeTrailingStop({ ...ETH_STOP, activationPx: ETH_MARK }),
      );

      expect(place).not.toHaveBeenCalled();
    });

    it('signs a sell activating above the mark, and a buy below it', async () => {
      const place = placed();
      const service = await setup(place);

      await service.placeTrailingStop({ ...ETH_STOP, activationPx: '2355' });
      await service.placeTrailingStop({
        ...ETH_STOP,
        isBuy: true,
        activationPx: '1700',
      });

      expect(place).toHaveBeenCalledTimes(2);
    });

    it('reads no mark price for an immediate trailing stop', async () => {
      const markets = jest.fn();
      const service = await setup(placed(), markets);

      await service.placeTrailingStop(ETH_STOP);

      expect(markets).not.toHaveBeenCalled();
    });

    it('signs nothing when the mark price cannot be read', async () => {
      const place = placed();
      const service = await setup(
        place,
        jest.fn().mockResolvedValue([{ name: 'ETH' }]),
      );

      const refused = await rejection(
        service.placeTrailingStop({ ...ETH_STOP, activationPx: '2355' }),
      );

      expect(refused.error).toBe('INVALID_MARKET_DATA');
      expect(place).not.toHaveBeenCalled();
    });
  });

  it('reports a refusal by the exchange with its text', async () => {
    const service = await setup(
      jest.fn().mockResolvedValue({
        status: 'err',
        response: 'Invalid activation price.',
      }),
    );

    const refused = await rejection(service.placeTrailingStop(ETH_STOP));

    expect(refused).toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
      error: 'EXCHANGE_TRAILING_STOP_REFUSED',
      message:
        'Hyperliquid refused the trailing stop: Invalid activation price.',
    });
  });

  // L'action n'a pas de cloid : une réponse illisible ne dit pas si le stop
  // suit le prix. L'appelant doit relire les ordres ouverts, pas renvoyer.
  it('reports an unreadable answer as a stop that may exist', async () => {
    const service = await setup(
      jest
        .fn()
        .mockResolvedValue({ status: 'ok', response: { type: 'default' } }),
    );

    const refused = await rejection(service.placeTrailingStop(ETH_STOP));

    expect(refused).toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
      error: 'EXCHANGE_UNEXPECTED_RESPONSE',
    });
    expect(refused.message).toContain('It may have been placed');
  });

  it('reports a failure after sending as a stop that may exist, and does not resend', async () => {
    const place = jest.fn().mockRejectedValue(new Error('fetch failed'));
    const service = await setup(place);

    const refused = await rejection(service.placeTrailingStop(ETH_STOP));

    expect(refused).toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
      error: 'EXCHANGE_OUTCOME_UNKNOWN',
    });
    expect(refused.message).toContain('It may have been placed');
    expect(place).toHaveBeenCalledTimes(1);
  });

  // Un agent refusé l'est avant toute signature : rien n'est parti, et le dire
  // « peut-être posé » serait faux dans l'autre sens.
  it('lets a refusal raised before sending pass through as it is', async () => {
    const service = await setup(
      jest
        .fn()
        .mockRejectedValue(new PreconditionFailedException('agent expired')),
    );

    const refused = await rejection(service.placeTrailingStop(ETH_STOP));

    expect(refused).toMatchObject({
      status: HttpStatus.PRECONDITION_FAILED,
      message: 'agent expired',
    });
  });
});
