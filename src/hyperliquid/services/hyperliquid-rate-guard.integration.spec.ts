import { HttpException, Logger } from '@nestjs/common';
import { HyperliquidApiPublicInfoService } from './hyperliquid-api-public-info.service';
import { HyperliquidApiTradeService } from './hyperliquid-api-trade.service';
import { HyperliquidRateGuardService } from './hyperliquid-rate-guard.service';
import {
  AssetRegistryService,
  REGISTRY_RETRY_BASE_MS,
} from './asset-registry.service';

/**
 * Le garde-fou n'a de valeur que branché. Ces tests éprouvent les deux points
 * de sortie vers Hyperliquid avec un `fetch` simulé, et vérifient la seule
 * chose qui compte : **après un refus de débit, plus rien ne part**.
 *
 * Et le démarrage : un gateway qui plante quand Hyperliquid refuse est relancé
 * par l'hébergeur, rappelle Hyperliquid et aggrave la sanction à chaque tour.
 */

function response(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe('garde-fou branché', () => {
  let fetchMock: jest.Mock;
  let guard: HyperliquidRateGuardService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    guard = new HyperliquidRateGuardService();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('lectures /info', () => {
    const info = () => new HyperliquidApiPublicInfoService(guard);
    const readDexs = (service: HyperliquidApiPublicInfoService) =>
      service.getAllPerpDexs();

    it('turns a Hyperliquid 429 into a real 429, not a 500 the bot would retry', async () => {
      fetchMock.mockResolvedValueOnce(response(429, null));

      const error = await readDexs(info()).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      const refused = error as HttpException;
      expect(refused.getStatus()).toBe(429);
      expect((refused.getResponse() as { error: string }).error).toBe(
        'HYPERLIQUID_RATE_LIMITED',
      );
    });

    it('sends nothing more once Hyperliquid has refused', async () => {
      fetchMock.mockResolvedValue(response(429, null));
      const service = info();

      await readDexs(service).catch(() => undefined);
      await readDexs(service).catch(() => undefined);
      await readDexs(service).catch(() => undefined);

      // Un seul appel réseau : les deux suivants sont refusés localement.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('counts the weight of every answered read', async () => {
      fetchMock.mockResolvedValue(response(200, [null, { name: 'xyz' }]));

      await readDexs(info());

      expect(guard.usage().used).toBe(20);
    });
  });

  describe('actions /exchange', () => {
    const trade = () =>
      new HyperliquidApiTradeService(
        { userId: 'u-1' } as never,
        { getDecryptedAgentKey: jest.fn().mockResolvedValue('0xkey') } as never,
        { getTimestamp: jest.fn().mockReturnValue(1) } as never,
        {} as never,
        {} as never,
        { signL1Action: jest.fn().mockResolvedValue('0xsig') } as never,
        { createFromPrivateKey: jest.fn().mockReturnValue({}) } as never,
        guard,
      );
    /** `executeWithNonce` est privée : on l'atteint sans passer par `any`. */
    type WithNonce = {
      executeWithNonce: (endpoint: string, action: object) => Promise<unknown>;
    };
    const send = (service: HyperliquidApiTradeService) =>
      (service as unknown as WithNonce).executeWithNonce('exchange', {
        type: 'order',
        orders: [{}],
      });

    it('never retries a 429, and pauses every later action', async () => {
      fetchMock.mockResolvedValue(response(429, null));
      const service = trade();

      const first = await send(service).catch((e: unknown) => e);
      await send(service).catch(() => undefined);

      expect((first as HttpException).getStatus()).toBe(429);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('recognises the address limit even when it comes back as HTTP 200', async () => {
      // Hyperliquid peut porter la limite par adresse dans le corps d'une
      // réponse 200. Sans ce contrôle, le refus passerait pour un succès.
      fetchMock.mockResolvedValueOnce(
        response(200, {
          status: 'err',
          response:
            'Too many cumulative requests sent (10001 > 10000) for cumulative volume traded $0.',
        }),
      );

      const error = await send(trade()).catch((e: unknown) => e);

      expect((error as HttpException).getStatus()).toBe(429);
      expect(guard.usage().cooldownRemainingMs).toBeGreaterThan(0);
    });
  });
});

describe('AssetRegistryService au démarrage', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function registry(ensureDexs: jest.Mock) {
    const metaCache = {
      ensureDexs,
      ensureSpotMeta: jest.fn().mockResolvedValue({ universe: [], tokens: [] }),
      ensurePerpMeta: jest.fn().mockResolvedValue({ universe: [] }),
      onMetaUpdated$: { subscribe: jest.fn() },
    };
    return {
      service: new AssetRegistryService(metaCache as never),
      metaCache,
    };
  }

  it('does not fail the boot when Hyperliquid refuses', async () => {
    // Avant : l'exception remontait de onModuleInit, Nest ne démarrait pas, le
    // processus s'arrêtait, et l'hébergeur le relançait aussitôt.
    const { service } = registry(
      jest.fn().mockRejectedValue(new Error('rate limited')),
    );

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('retries slowly, and not before the first backoff', async () => {
    const ensureDexs = jest
      .fn()
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValue([]);
    const { service } = registry(ensureDexs);

    await service.onModuleInit();
    expect(ensureDexs).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(REGISTRY_RETRY_BASE_MS - 1);
    expect(ensureDexs).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    expect(ensureDexs).toHaveBeenCalledTimes(2);
  });

  it('doubles the wait while the failure lasts', async () => {
    const ensureDexs = jest.fn().mockRejectedValue(new Error('down'));
    const { service } = registry(ensureDexs);

    await service.onModuleInit();
    await jest.advanceTimersByTimeAsync(REGISTRY_RETRY_BASE_MS);
    expect(ensureDexs).toHaveBeenCalledTimes(2);

    // Le deuxième délai vaut le double : rien avant 120 s.
    await jest.advanceTimersByTimeAsync(2 * REGISTRY_RETRY_BASE_MS - 1);
    expect(ensureDexs).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(ensureDexs).toHaveBeenCalledTimes(3);

    service.onModuleDestroy();
  });

  it('stops retrying when the module is destroyed', async () => {
    const ensureDexs = jest.fn().mockRejectedValue(new Error('down'));
    const { service } = registry(ensureDexs);

    await service.onModuleInit();
    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(10 * REGISTRY_RETRY_BASE_MS);

    expect(ensureDexs).toHaveBeenCalledTimes(1);
  });
});
