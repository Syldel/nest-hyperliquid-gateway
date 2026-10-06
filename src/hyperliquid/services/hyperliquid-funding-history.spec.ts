import { Logger } from '@nestjs/common';
import { HyperliquidApiPublicInfoService } from './hyperliquid-api-public-info.service';
import { HyperliquidRateGuardService } from './hyperliquid-rate-guard.service';
import { infoRequestWeight } from './hyperliquid-rate-guard.service';

/**
 * ============================================================================
 * CE QUI PART VRAIMENT VERS HYPERLIQUID
 *
 * `fundingHistory` prend ses paramètres **à plat**, là où `candleSnapshot`
 * imbrique les siens sous `req`. C'est la seule chose que ce service décide,
 * et se tromper donne un appel refusé plutôt qu'une réponse vide — donc les
 * tests portent sur le **corps envoyé**, pas seulement sur la valeur rendue.
 *
 * Les réponses simulées sont celles réellement mesurées le 2026-10-06 sur
 * `api.hyperliquid.xyz` : BTC vivant, MATIC délisté, `xyz:XYZ100` sur un dex
 * HIP-3. Un double ne rend que ce que le vrai rendrait.
 * ============================================================================
 */

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** BTC, mesuré : le taux au plancher, une prime négative, horodatage non rond. */
const BTC_MEASURED = [
  {
    coin: 'BTC',
    fundingRate: '0.0000125',
    premium: '-0.0001505982',
    time: 1791280800037,
  },
  {
    coin: 'BTC',
    fundingRate: '0.0000125',
    premium: '-0.0001604713',
    time: 1791284400039,
  },
];

describe('getFundingHistory', () => {
  let fetchMock: jest.Mock;
  let service: HyperliquidApiPublicInfoService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    service = new HyperliquidApiPublicInfoService(
      new HyperliquidRateGuardService(),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  /**
   * Le corps réellement envoyé à Hyperliquid, relu depuis l'appel simulé.
   *
   * Typé pas à pas plutôt qu'en une expression : `jest.Mock.mock.calls` est
   * un `any[][]`, et le lint du dépôt refuse à juste titre un accès membre
   * dessus — c'est exactement le genre d'endroit où une erreur de forme
   * passerait inaperçue.
   */
  const sentBody = (): Record<string, unknown> => {
    const call = fetchMock.mock.calls[0] as [string, { body: string }];
    return JSON.parse(call[1].body) as Record<string, unknown>;
  };

  it('sends the parameters flat, not nested under `req` like candleSnapshot', async () => {
    fetchMock.mockResolvedValueOnce(response(200, BTC_MEASURED));

    await service.getFundingHistory({ coin: 'BTC', startTime: 1791259200000 });

    expect(sentBody()).toEqual({
      type: 'fundingHistory',
      coin: 'BTC',
      startTime: 1791259200000,
    });
  });

  // `JSON.stringify` supprime les clés `undefined`, donc la clé n'atteint
  // jamais Hyperliquid quand l'appelant n'en donne pas — et il la remplace par
  // l'instant courant. Ce test épingle le résultat observable, pas la façon de
  // l'obtenir : une mutation a montré qu'un `if` en amont ne changeait rien.
  it('omits endTime entirely when the caller did not give one', async () => {
    fetchMock.mockResolvedValueOnce(response(200, BTC_MEASURED));

    await service.getFundingHistory({ coin: 'BTC', startTime: 1791259200000 });

    expect('endTime' in sentBody()).toBe(false);
  });

  it('passes endTime through when the caller gives one', async () => {
    fetchMock.mockResolvedValueOnce(response(200, BTC_MEASURED));

    await service.getFundingHistory({
      coin: 'BTC',
      startTime: 1791259200000,
      endTime: 1791288000000,
    });

    expect(sentBody().endTime).toBe(1791288000000);
  });

  // Le préfixe de dex traverse sans transformation : mesuré, le `coin` rendu
  // par Hyperliquid est identique à celui demandé.
  it('sends a HIP-3 market name with its dex prefix untouched', async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, [
        {
          coin: 'xyz:XYZ100',
          fundingRate: '0.00000625',
          premium: '0.000019168',
          time: 1791280800037,
        },
      ]),
    );

    const entries = await service.getFundingHistory({
      coin: 'xyz:XYZ100',
      startTime: 1791259200000,
    });

    expect(sentBody().coin).toBe('xyz:XYZ100');
    expect(entries[0].coin).toBe('xyz:XYZ100');
  });

  it('returns the entries as the exchange sent them', async () => {
    fetchMock.mockResolvedValueOnce(response(200, BTC_MEASURED));

    const entries = await service.getFundingHistory({
      coin: 'BTC',
      startTime: 1791259200000,
    });

    expect(entries).toEqual(BTC_MEASURED);
  });

  /**
   * La garde qui compte pour la suite : ce zéro a **trois** significations
   * qu'aucune donnée de cette réponse ne distingue — marché délisté, marché
   * vivant sur un dex à multiplicateur nul (`flx`, `vntl`), ou heure réellement
   * sans financement. Les filtrer ici effacerait ce que l'appelant doit croiser
   * avec `isDelisted` et `assetToFundingMultiplier` pour trancher.
   */
  it('keeps zero-rate entries instead of treating them as nothing', async () => {
    const delisted = [
      {
        coin: 'MATIC',
        fundingRate: '0.0',
        premium: '0.0',
        time: 1791280800037,
      },
      {
        coin: 'MATIC',
        fundingRate: '0.0',
        premium: '0.0',
        time: 1791284400039,
      },
    ];
    fetchMock.mockResolvedValueOnce(response(200, delisted));

    const entries = await service.getFundingHistory({
      coin: 'MATIC',
      startTime: 1791259200000,
    });

    expect(entries).toHaveLength(2);
    expect(entries[0].fundingRate).toBe('0.0');
  });

  it('returns an empty list without inventing anything', async () => {
    fetchMock.mockResolvedValueOnce(response(200, []));

    await expect(
      service.getFundingHistory({ coin: 'BTC', startTime: 1791259200000 }),
    ).resolves.toEqual([]);
  });

  // Le garde-fou n'a de valeur que branché : l'appel doit être compté, et le
  // poids de cet endpoint n'est pas celui d'une lecture légère.
  it('is weighed as a per-item info call, not as a light one', () => {
    expect(infoRequestWeight('fundingHistory')).toBe(20);
    expect(infoRequestWeight('fundingHistory', 30)).toBe(22);
    expect(infoRequestWeight('l2Book')).toBe(2);
  });

  // Un 429 ne doit jamais devenir un 500, qui inviterait l'appelant à relancer.
  it('turns a Hyperliquid 429 into a real 429', async () => {
    fetchMock.mockResolvedValueOnce(response(429, null));

    await expect(
      service.getFundingHistory({ coin: 'BTC', startTime: 1791259200000 }),
    ).rejects.toMatchObject({ status: 429 });
  });
});
