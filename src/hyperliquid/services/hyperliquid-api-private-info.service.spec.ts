import { HyperliquidApiPrivateInfoService } from './hyperliquid-api-private-info.service';

/**
 * Le chemin de `historicalOrders`, de l'appel au poids compté. Ce que ce test fige : l'appel passe par `executeInfo`
 * (donc par le garde de débit), il porte le portefeuille de l'utilisateur, et son poids est compté sur les
 * enregistrements rendus — 20, plus 1 par tranche de 20, arrondie au-dessus.
 */
describe('HyperliquidApiPrivateInfoService.getHistoricalOrders', () => {
  const wallet = '0x0000000000000000000000000000000000000001';
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  const withAnswer = (records: unknown[]) => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve(records),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const rateGuard = {
      beforeCall: jest.fn(),
      recordResponse: jest.fn(),
    };
    const service = new HyperliquidApiPrivateInfoService(
      { walletAddress: wallet } as never,
      rateGuard as never,
    );
    return { service, rateGuard, fetchMock };
  };

  it('asks Hyperliquid for the historical orders of the user, once', async () => {
    const { service, fetchMock } = withAnswer([]);

    await service.getHistoricalOrders();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.hyperliquid.xyz/info');
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'historicalOrders',
      user: wallet,
    });
  });

  it('counts a weight of 20 before the call and 20 + 1 per 20 records after it', async () => {
    const records = Array.from({ length: 41 }, (_, i) => ({ order: { i } }));
    const { service, rateGuard } = withAnswer(records);

    const answer = await service.getHistoricalOrders();

    expect(answer).toHaveLength(41);
    expect(rateGuard.beforeCall).toHaveBeenCalledWith('info', 20);
    // 41 enregistrements = 3 tranches de 20, arrondies au-dessus : 23.
    expect(rateGuard.recordResponse).toHaveBeenCalledWith(23, true);
  });

  it('asks the testnet when it is told to', async () => {
    const { service, fetchMock } = withAnswer([]);

    await service.getHistoricalOrders(true);

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      'https://testnet.hyperliquid.xyz/info',
    );
  });
});

/**
 * Le compteur de la limite par adresse. Ce que ce test fige : l'appel passe par le garde de débit avec le poids d'une
 * lecture ordinaire (20), il porte le portefeuille de l'utilisateur, et la réponse est rendue telle quelle. La réponse
 * du double est l'exemple de la doc (`info-endpoint`, « Query user rate limits »), pas une mesure.
 */
describe('HyperliquidApiPrivateInfoService.getUserRateLimit', () => {
  const wallet = '0x0000000000000000000000000000000000000001';
  const realFetch = global.fetch;
  const DOC_EXAMPLE = {
    cumVlm: '2854574.593578',
    nRequestsUsed: 2890,
    nRequestsCap: 2864574,
    nRequestsSurplus: 0,
  };

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('asks Hyperliquid for the user counter, weighs it 20, and hands it back', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve(DOC_EXAMPLE),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const rateGuard = { beforeCall: jest.fn(), recordResponse: jest.fn() };
    const service = new HyperliquidApiPrivateInfoService(
      { walletAddress: wallet } as never,
      rateGuard as never,
    );

    const answer = await service.getUserRateLimit();

    expect(answer).toEqual(DOC_EXAMPLE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.hyperliquid.xyz/info');
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'userRateLimit',
      user: wallet,
    });
    expect(rateGuard.beforeCall).toHaveBeenCalledWith('info', 20);
  });
});
