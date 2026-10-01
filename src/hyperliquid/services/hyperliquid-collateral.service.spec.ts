import { HyperliquidCollateralService } from './hyperliquid-collateral.service';

/**
 * ============================================================================
 * TROIS RÉPONSES, PAS UN NOMBRE
 *
 * « Tu n'as rien », « je ne trouve pas de ligne pour cet actif » et « je ne
 * sais pas dans quoi ce marché se règle » appellent trois remèdes différents :
 * approvisionner, vérifier le nom, attendre la synchronisation du registre.
 * Tant que les trois rendaient `'0'`, ils étaient indiscernables — et `'0'`
 * dimensionne des ordres (`smart-order.service`, `hl-protection.service`).
 * ============================================================================
 */

const USDC = 0;
const USDT = 2;

function buildService(params: {
  mode?: string;
  collateralByAsset?: Record<string, number>;
  balances?: { coin: string; token: number; total: string; hold: string }[];
  perpAccountValue?: string;
}) {
  const {
    mode = 'unifiedAccount',
    collateralByAsset = { BTC: USDC, 'cash:TSLA': USDT },
    balances = [
      { coin: 'USDC', token: USDC, total: '1000', hold: '250' },
      { coin: 'USDT', token: USDT, total: '40', hold: '0' },
    ],
    perpAccountValue = '77',
  } = params;

  const registry = {
    getCollateralToken: (asset: string) => collateralByAsset[asset],
    getTokenSymbol: (index: number) =>
      ({ [USDC]: 'USDC', [USDT]: 'USDT' })[index],
  };

  const privateInfo = {
    getAccountMode: jest.fn().mockResolvedValue(mode),
    getSpotBalances: jest.fn().mockResolvedValue({ balances }),
    getPerpAccountState: jest.fn().mockResolvedValue({
      marginSummary: { accountValue: perpAccountValue, totalMarginUsed: '12' },
    }),
  };

  return new HyperliquidCollateralService(
    registry as never,
    privateInfo as never,
  );
}

describe('HyperliquidCollateralService.getCollateralBalance', () => {
  it('reads the balance of the collateral the registry derived', async () => {
    const service = buildService({});

    await expect(service.getCollateralBalance('BTC')).resolves.toEqual({
      status: 'ok',
      mode: 'unifiedAccount',
      collateral: 'USDC',
      collateralToken: USDC,
      total: '1000',
      used: '250',
    });
  });

  // Le collatéral vient du registre, donc d'un dex à l'autre il change — ce que
  // la table en dur ne savait faire que pour deux dex, tous deux éteints.
  it('reads another collateral for a market that settles in another token', async () => {
    const service = buildService({});

    await expect(
      service.getCollateralBalance('cash:TSLA'),
    ).resolves.toMatchObject({ status: 'ok', collateral: 'USDT', total: '40' });
  });

  // Le cœur du chantier : plus aucun `'0'` par défaut.
  it('never answers a number when the registry cannot resolve the collateral', async () => {
    const service = buildService({ collateralByAsset: {} });

    await expect(service.getCollateralBalance('NOPE')).resolves.toEqual({
      status: 'unknown-collateral',
      mode: 'unifiedAccount',
      asset: 'NOPE',
    });
  });

  it('distinguishes a missing balance line from a zero balance', async () => {
    const service = buildService({
      balances: [{ coin: 'USDC', token: USDC, total: '0', hold: '0' }],
    });

    await expect(service.getCollateralBalance('BTC')).resolves.toMatchObject({
      status: 'ok',
      total: '0',
    });
    await expect(
      service.getCollateralBalance('cash:TSLA'),
    ).resolves.toMatchObject({
      status: 'no-balance-entry',
      collateral: 'USDT',
    });
  });

  // Un solde se retrouve par index, pas par symbole : deux tokens peuvent
  // porter le même nom, aucun ne partage un index.
  it('matches a balance by token index, not by symbol', async () => {
    const service = buildService({
      balances: [
        // Un homonyme placé en tête, avec un autre index : une recherche par
        // symbole le prendrait et lirait 999 au lieu de 1000.
        { coin: 'USDC', token: 42, total: '999', hold: '0' },
        { coin: 'USDC', token: USDC, total: '1000', hold: '250' },
      ],
    });

    await expect(service.getCollateralBalance('BTC')).resolves.toMatchObject({
      total: '1000',
    });
  });

  /**
   * ⚠️ `'default'` est une valeur de `AccountAbstractionMode`, mais **laquelle**
   * de ses valeurs correspond au mode « Manual / Standard » de la doc n'a pas
   * été vérifiée : le compte de développement est unifié, aucune mesure ne
   * pouvait le dire. Ces tests n'en dépendent pas — la branche se déclenche sur
   * « ni unifié ni portfolio margin », quel que soit le nom de l'autre cas.
   */
  describe('standard (siloed) mode', () => {
    // Le défaut corrigé : `isPerp` du registre valait `!isSpot && !isBuilder`,
    // donc un HIP-3 (`cash:TSLA`) n'en était pas un et prenait la branche spot
    // — précisément les dex dont le collatéral n'est pas de l'USDC. La doc est
    // explicite : en mode Standard, « separate perp and spot balances,
    // separate DEX balances ».
    it('reads the perp state of a HIP-3 market, not the spot balances', async () => {
      const service = buildService({ mode: 'default' });

      await expect(
        service.getCollateralBalance('cash:TSLA'),
      ).resolves.toMatchObject({ status: 'ok', total: '77', used: '12' });
    });

    it('reads the perp state of a main-dex market too', async () => {
      const service = buildService({ mode: 'default' });

      await expect(service.getCollateralBalance('BTC')).resolves.toMatchObject({
        status: 'ok',
        total: '77',
      });
    });

    // Un compte unifié ignore cette branche : la doc dit que l'état spot y fait
    // autorité, et que « individual perp dex user states are not meaningful ».
    it('ignores the perp state entirely on a unified account', async () => {
      const service = buildService({ mode: 'unifiedAccount' });

      await expect(service.getCollateralBalance('BTC')).resolves.toMatchObject({
        total: '1000',
      });
    });
  });
});
