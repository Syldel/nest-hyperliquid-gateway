import type {
  HLPerpMeta,
  HLSpotMeta,
  HLSpotTokenMeta,
} from '@syldel/hl-shared-types';
import { AssetRegistryService } from './asset-registry.service';

/**
 * ============================================================================
 * LE COLLATÉRAL SE DÉRIVE, IL NE SE DEVINE PAS
 *
 * Les trois dépôts tenaient une table en dur — `hyna → USDE`, `cash → USDT`,
 * sinon USDC. Elle était juste quand elle a été écrite, mais ces deux dex ont
 * été éteints en juin et août 2026, et elle n'a jamais couvert que 2 des 10 dex
 * déployés. L'exchange publie la correspondance (`meta({dex}).collateralToken`)
 * et c'est la seule version qui ne vieillit pas.
 *
 * Ce que ces tests protègent n'est pas un affichage : ce collatéral dimensionne
 * des ordres (`hl-protection.service`, `smart-order.service`). Une paire
 * appariée au mauvais token ferait calculer une taille sur le solde d'un autre
 * actif.
 * ============================================================================
 */

function token(name: string, index: number): HLSpotTokenMeta {
  return {
    name,
    index,
    szDecimals: 2,
    weiDecimals: 8,
    tokenId: `0x${index}`,
    isCanonical: true,
    evmContract: null,
    fullName: null,
  };
}

/**
 * ⚠️ Les tokens sont **volontairement** rangés dans un ordre qui ne suit pas
 * leurs index, et leurs index ne sont pas contigus. Le registre indexait
 * jusqu'ici le tableau par position (`tokens[market.tokens[0]]`), ce qui ne
 * marche que si les deux coïncident — ce que rien ne garantit.
 */
const SPOT_META: HLSpotMeta = {
  tokens: [
    token('HYPE', 150),
    token('USDT', 2),
    token('USDC', 0),
    token('PURR', 1),
  ],
  universe: [
    // PURR/USDC : base PURR (1), quote USDC (0). Index 0 → nom « PURR/USDC ».
    { name: 'PURR/USDC', tokens: [1, 0], index: 0, isCanonical: true },
    // Une paire cotée en USDT, pour qu'un seul quote ne puisse pas tout faire passer.
    { name: 'HYPE/USDT', tokens: [150, 2], index: 107, isCanonical: false },
  ],
};

function perpMeta(names: string[], collateralToken?: number): HLPerpMeta {
  return {
    universe: names.map((name) => ({ name, szDecimals: 2, maxLeverage: 20 })),
    marginTables: [],
    ...(collateralToken !== undefined && { collateralToken }),
  };
}

/** Le dex principal règle en USDC (token 0), `xyz` en USDT (token 2). */
const PERP_BY_DEX: Record<string, HLPerpMeta> = {
  '': perpMeta(['BTC', 'ETH'], 0),
  xyz: perpMeta(['xyz:AAPL'], 2),
  // Un dex dont le `meta` ne porte pas le champ : rien ne doit être enregistré.
  mute: perpMeta(['mute:FOO']),
};

function buildRegistry(): AssetRegistryService {
  const metaCache = {
    ensureDexs: jest
      .fn()
      .mockResolvedValue([null, { name: 'xyz' }, { name: 'mute' }]),
    ensureSpotMeta: jest.fn().mockResolvedValue(SPOT_META),
    ensurePerpMeta: jest
      .fn()
      .mockImplementation((dex: string) => Promise.resolve(PERP_BY_DEX[dex])),
    onMetaUpdated$: { subscribe: jest.fn() },
  };

  return new AssetRegistryService(metaCache as never);
}

describe('AssetRegistryService — collateral derivation', () => {
  let registry: AssetRegistryService;

  beforeEach(async () => {
    registry = buildRegistry();
    await registry.refreshSymbols();
  });

  it('settles a main-dex perp in the collateral its own meta declares', () => {
    expect(registry.getCollateralToken('BTC')).toBe(0);
  });

  // Le point de toute la manœuvre : chaque dex porte son propre collatéral, et
  // ce n'est pas celui du dex principal.
  it('settles a HIP-3 perp in its own dex collateral, not the main one', () => {
    expect(registry.getCollateralToken('xyz:AAPL')).toBe(2);
  });

  // Une absence n'a pas de repli. Rendre USDC ici est exactement ce que la
  // table en dur faisait, et ce que ce registre remplace.
  it('registers nothing for a dex whose meta omits the collateral token', () => {
    expect(registry.getCollateralToken('mute:FOO')).toBeUndefined();
  });

  it('settles a spot pair in its quote token', () => {
    expect(registry.getCollateralToken('PURR/USDC')).toBe(0);
  });

  // La régression que le correctif d'indexation protège : HYPE porte l'index
  // 150 et occupe la position 0 du tableau. Une lecture par position aurait
  // rendu un quote faux, donc un solde lu sur le mauvais actif.
  it('resolves a quote token by its index, never by its position in the array', () => {
    expect(registry.getCollateralToken('@107')).toBe(2);
  });

  // Un même marché s'enregistre sous plusieurs noms ; tous doivent porter le
  // même collatéral, sans quoi la réponse dépendrait du nom demandé.
  it('gives every alias of a market the same collateral', () => {
    expect(registry.getCollateralToken('@107')).toBe(
      registry.getCollateralToken('HYPE/USDT'),
    );
  });

  it('has no collateral to offer for a market it never indexed', () => {
    expect(registry.getCollateralToken('NOPE')).toBeUndefined();
  });

  // Une resynchronisation remplace le catalogue, elle ne s'y ajoute pas. Sans
  // ça, un marché retiré de l'exchange garderait son collatéral indéfiniment —
  // et répondrait encore à une question qu'on n'aurait plus le droit de poser.
  it('forgets a market the exchange no longer serves after a resync', async () => {
    // Le registre du `beforeEach` connaît `xyz:AAPL` et HYPE ; on lui sert
    // ensuite un catalogue réduit.
    const shrunk = {
      ensureDexs: jest.fn().mockResolvedValue([null]),
      ensureSpotMeta: jest.fn().mockResolvedValue({ tokens: [], universe: [] }),
      ensurePerpMeta: jest.fn().mockResolvedValue(perpMeta(['ETH'], 0)),
    };
    (registry as unknown as { metaCache: typeof shrunk }).metaCache = shrunk;

    await registry.refreshSymbols();

    expect(registry.getCollateralToken('ETH')).toBe(0);
    expect(registry.getCollateralToken('xyz:AAPL')).toBeUndefined();
    expect(registry.getTokenSymbol(150)).toBeUndefined();
  });

  describe('token symbols', () => {
    it('names a token by its index, including a non-contiguous one', () => {
      expect(registry.getTokenSymbol(150)).toBe('HYPE');
      expect(registry.getTokenSymbol(0)).toBe('USDC');
    });

    it('has no name to offer for an index it never saw', () => {
      expect(registry.getTokenSymbol(999)).toBeUndefined();
    });
  });
});
