import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import {
  exchangeRequestWeight,
  HyperliquidRateGuardService,
  infoRequestWeight,
  isAddressRateLimitMessage,
  parseRetryAfterMs,
  RATE_LIMITS,
} from './hyperliquid-rate-guard.service';

/**
 * Ce spec fixe ce qui protège l'IP. Chaque règle testée ici est une règle
 * dont la violation peut valoir un bannissement : c'est pourquoi les bords
 * (pile au plafond, pile à la fin de la pause, fenêtre qui glisse) sont
 * couverts un par un.
 */
describe('HyperliquidRateGuardService', () => {
  let guard: HyperliquidRateGuardService;
  const T0 = new Date('2026-09-21T12:00:00Z').getTime();

  const status = (fn: () => unknown): number | undefined => {
    try {
      fn();
      return undefined;
    } catch (error) {
      return error instanceof HttpException ? error.getStatus() : undefined;
    }
  };

  const code = (fn: () => unknown): string | undefined => {
    try {
      fn();
      return undefined;
    } catch (error) {
      return error instanceof HttpException
        ? (error.getResponse() as { error?: string }).error
        : undefined;
    }
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    guard = new HyperliquidRateGuardService();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('la pause après un 429', () => {
    it('refuses every later call, reads and orders alike, without touching the network', () => {
      guard.rateLimited('info:candleSnapshot');

      expect(status(() => guard.beforeCall('info', 20))).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      // Les ordres aussi : Hyperliquid les refuserait de toute façon, et
      // insister prolongerait la sanction.
      expect(status(() => guard.beforeCall('exchange', 1))).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect(code(() => guard.beforeCall('info', 20))).toBe(
        'HYPERLIQUID_RATE_LIMITED',
      );
    });

    it('returns a real 429, not a 500 the client would retry', () => {
      const error = guard.rateLimited('exchange');

      expect(error.getStatus()).toBe(429);
      expect((error.getResponse() as { error: string }).error).toBe(
        'HYPERLIQUID_RATE_LIMITED',
      );
    });

    it('lets calls through again exactly when the pause ends', () => {
      guard.rateLimited('info:meta');

      jest.setSystemTime(T0 + RATE_LIMITS.cooldownBaseMs - 1);
      expect(status(() => guard.beforeCall('info', 20))).toBe(429);

      jest.setSystemTime(T0 + RATE_LIMITS.cooldownBaseMs);
      expect(status(() => guard.beforeCall('info', 20))).toBeUndefined();
    });

    it('doubles the pause on consecutive 429s, up to a ceiling', () => {
      const pauses: number[] = [];
      for (let i = 0; i < 6; i++) {
        guard.rateLimited('info:meta');
        pauses.push(guard.usage().cooldownRemainingMs);
      }

      expect(pauses).toEqual([
        60_000,
        120_000,
        240_000,
        480_000,
        RATE_LIMITS.cooldownMaxMs,
        RATE_LIMITS.cooldownMaxMs,
      ]);
    });

    it('resets the escalation once a call succeeds', () => {
      guard.rateLimited('info:meta');
      guard.rateLimited('info:meta');
      jest.setSystemTime(T0 + RATE_LIMITS.cooldownMaxMs);
      guard.recordResponse(20, true);

      guard.rateLimited('info:meta');

      expect(guard.usage().cooldownRemainingMs).toBe(
        RATE_LIMITS.cooldownBaseMs,
      );
    });

    it('honours Retry-After when it asks for longer than the backoff', () => {
      guard.rateLimited('info:meta', 300_000);

      expect(guard.usage().cooldownRemainingMs).toBe(300_000);
    });

    it('never shortens the backoff because Retry-After is short', () => {
      guard.rateLimited('info:meta', 1_000);

      expect(guard.usage().cooldownRemainingMs).toBe(
        RATE_LIMITS.cooldownBaseMs,
      );
    });
  });

  describe('le plafond local', () => {
    const ceiling = Math.floor(
      RATE_LIMITS.ipWeightPerMinute * RATE_LIMITS.localCeilingRatio,
    );

    it('refuses a read that would cross the local ceiling', () => {
      guard.recordResponse(ceiling - 10, true);

      expect(status(() => guard.beforeCall('info', 10))).toBeUndefined();
      expect(code(() => guard.beforeCall('info', 11))).toBe(
        'LOCAL_RATE_BUDGET',
      );
    });

    it('never refuses an order because of the local ceiling', () => {
      // Refuser la fermeture d'une position parce qu'on a trop lu serait pire
      // que le risque évité. Seule une vraie pause d'Hyperliquid les arrête.
      guard.recordResponse(RATE_LIMITS.ipWeightPerMinute, true);

      expect(status(() => guard.beforeCall('exchange', 1))).toBeUndefined();
    });

    it('does not open a pause when refusing locally', () => {
      // Le plafond local est un frein, pas une sanction : il ne doit pas
      // bloquer les ordres ni se prolonger tout seul.
      guard.recordResponse(ceiling, true);
      code(() => guard.beforeCall('info', 20));

      expect(guard.usage().cooldownRemainingMs).toBe(0);
    });

    it('frees the budget as the one-minute window slides', () => {
      guard.recordResponse(ceiling, true);
      expect(code(() => guard.beforeCall('info', 20))).toBe(
        'LOCAL_RATE_BUDGET',
      );

      jest.setSystemTime(T0 + RATE_LIMITS.windowMs);
      expect(status(() => guard.beforeCall('info', 20))).toBeUndefined();
    });

    it('counts failed responses too, since Hyperliquid counts them', () => {
      guard.recordResponse(ceiling, false);

      expect(code(() => guard.beforeCall('info', 20))).toBe(
        'LOCAL_RATE_BUDGET',
      );
    });
  });
});

describe('le poids des requêtes', () => {
  it('weights light reads at 2', () => {
    expect(infoRequestWeight('clearinghouseState')).toBe(2);
    expect(infoRequestWeight('orderStatus')).toBe(2);
    expect(infoRequestWeight('allMids')).toBe(2);
  });

  it('weights ordinary reads at 20', () => {
    expect(infoRequestWeight('meta')).toBe(20);
    expect(infoRequestWeight('frontendOpenOrders')).toBe(20);
    expect(infoRequestWeight('metaAndAssetCtxs')).toBe(20);
  });

  it('adds one per started block of 60 candles, rounding up', () => {
    // Le bot demande 500 bougies : 20 + ceil(500 / 60) = 29.
    expect(infoRequestWeight('candleSnapshot')).toBe(20);
    expect(infoRequestWeight('candleSnapshot', 60)).toBe(21);
    expect(infoRequestWeight('candleSnapshot', 61)).toBe(22);
    expect(infoRequestWeight('candleSnapshot', 500)).toBe(29);
  });

  it('adds one per started block of 20 items for fill-like reads', () => {
    expect(infoRequestWeight('userFills', 45)).toBe(23);
  });

  it('weights userRole at 60', () => {
    expect(infoRequestWeight('userRole')).toBe(60);
  });

  it('weights an exchange action by its batch size', () => {
    expect(exchangeRequestWeight({ type: 'order', orders: [{}] })).toBe(1);
    expect(
      exchangeRequestWeight({ type: 'order', orders: new Array(40).fill({}) }),
    ).toBe(2);
    expect(exchangeRequestWeight({ type: 'cancel', cancels: [{}, {}] })).toBe(
      1,
    );
    expect(exchangeRequestWeight({ type: 'updateLeverage' })).toBe(1);
  });
});

describe('les signaux de limite', () => {
  it('recognises the documented address-limit message', () => {
    expect(
      isAddressRateLimitMessage(
        'Too many cumulative requests sent (10001 > 10000) for cumulative volume traded $0.',
      ),
    ).toBe(true);
    expect(isAddressRateLimitMessage('Insufficient margin')).toBe(false);
    expect(isAddressRateLimitMessage(undefined)).toBe(false);
  });

  it('reads Retry-After in seconds', () => {
    expect(parseRetryAfterMs('30')).toBe(30_000);
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs('soon')).toBeUndefined();
    expect(parseRetryAfterMs('0')).toBeUndefined();
  });
});
