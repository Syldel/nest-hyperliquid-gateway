import type {
  HLPerpMeta,
  HLSpotMeta,
  HLSpotTokenMeta,
} from '@syldel/hl-shared-types';

import { AssetRegistryService } from './asset-registry.service';

/**
 * ============================================================================
 * LES FIXTURES DU REGISTRE D'ACTIFS, PARTAGÉES
 *
 * Extraites de `asset-registry.collateral.spec.ts` le 2026-10-08, quand
 * l'encodage des identifiants d'actif a reçu ses propres tests. Les y laisser
 * aurait obligé à écrire des tests d'identifiant dans un fichier nommé
 * `collateral`, ou à recopier les fixtures — deux copies qui dérivent.
 *
 * ⚠️ Ces fixtures portent des choix **volontaires** et non des valeurs
 * arbitraires : les index de token ne sont pas contigus et ne suivent pas
 * l'ordre du tableau, et les trois dex couvrent le cas principal, un dex HIP-3
 * et un dex dont le `meta` omet son collatéral. Changer l'un de ces détails
 * désarme des tests qui ne le diront pas.
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
export const SPOT_META: HLSpotMeta = {
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

export function perpMeta(
  names: string[],
  collateralToken?: number,
): HLPerpMeta {
  return {
    // `marginTableId` égale `maxLeverage` sur les quatre dex HIP-3 relevés
    // (`xyz` 30/30, `para` 20/20, `mkts` 25/25, `io` 6/6) ; le dex principal,
    // lui, ne suit pas cette règle (BTC : 56 pour 40x). Ici n'importe quelle
    // valeur ferait l'affaire — mais une valeur plausible coûte le même prix.
    universe: names.map((name) => ({
      name,
      szDecimals: 2,
      maxLeverage: 20,
      marginTableId: 20,
    })),
    marginTables: [],
    ...(collateralToken !== undefined && { collateralToken }),
  };
}

/**
 * Le dex principal règle en USDC (token 0), `xyz` en USDT (token 2).
 *
 * ⚠️ L'ordre des clés est sans effet : ce qui donne son index à un dex est sa
 * position dans `ensureDexs`, pas sa place ici.
 */
export const PERP_BY_DEX: Record<string, HLPerpMeta> = {
  '': perpMeta(['BTC', 'ETH'], 0),
  xyz: perpMeta(['xyz:XYZ100', 'xyz:AAPL'], 2),
  // Un dex dont le `meta` ne porte pas le champ : rien ne doit être enregistré.
  mute: perpMeta(['mute:FOO']),
};

/**
 * ⚠️ Le premier élément est `null`, et ce n'est pas un oubli : c'est ainsi que
 * l'exchange désigne le dex principal dans `perpDexs`. Sa position donne son
 * index — 0 pour le principal, 1 pour `xyz`, 2 pour `mute` —, et cet index
 * entre directement dans le calcul de l'identifiant d'actif.
 */
export const DEXS = [null, { name: 'xyz' }, { name: 'mute' }];

export function buildRegistry(): AssetRegistryService {
  const metaCache = {
    ensureDexs: jest.fn().mockResolvedValue(DEXS),
    ensureSpotMeta: jest.fn().mockResolvedValue(SPOT_META),
    ensurePerpMeta: jest
      .fn()
      .mockImplementation((dex: string) => Promise.resolve(PERP_BY_DEX[dex])),
    onMetaUpdated$: { subscribe: jest.fn() },
  };

  return new AssetRegistryService(metaCache as never);
}
