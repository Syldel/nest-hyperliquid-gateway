import { AssetRegistryService } from './asset-registry.service';
import {
  buildRegistry,
  PERP_BY_DEX,
  perpMeta,
} from './asset-registry.fixtures';

/**
 * ============================================================================
 * L'IDENTIFIANT D'ACTIF — LE NOMBRE QUI CHOISIT LE MARCHÉ
 *
 * `getAssetId` rend l'entier que portent `order` et `cancel`. C'est lui, et
 * rien d'autre, qui décide sur quel marché un ordre atterrit. Il n'avait
 * **aucun test** jusqu'au 2026-10-08 : les dix tests du registre portaient tous
 * sur le collatéral.
 *
 * Et c'est exactement le genre d'écart que la règle HIP-3 du `CLAUDE.md` vise :
 * un marché standard ne prédit pas un marché HIP-3. Les deux encodages n'ont
 * **pas la même forme** :
 *
 * - dex principal : l'identifiant est l'index dans l'univers, donc 0, 1, 2… ;
 * - dex HIP-3 : `100000 + index_du_dex * 10000 + index_dans_l_univers`.
 *
 * **Vérifié en production le 2026-10-08**, contre le registre réel du gateway :
 *
 * ```
 * BTC            0          ETH   1
 * xyz:XYZ100     110000     (index 0 de l'univers xyz)
 * xyz:MU         110015     (index 15)
 * xyz:BRENTOIL   110049     (index 49)
 * ```
 *
 * `xyz` étant le dex d'index 1, `100000 + 10000 + index` redonne les trois
 * valeurs. Les positions ont été recoupées avec l'univers servi par
 * `meta({dex:'xyz'})`, pas déduites de l'implémentation.
 *
 * Ce que ces tests protègent n'est donc pas un calcul abstrait : trois ordres
 * de grandeur séparent les deux familles, si bien qu'une confusion n'enverrait
 * pas un ordre « un peu à côté » — elle l'enverrait sur un actif inexistant,
 * ou sur un tout autre marché.
 * ============================================================================
 */
describe('AssetRegistryService — asset id encoding', () => {
  let registry: AssetRegistryService;

  beforeEach(async () => {
    registry = buildRegistry();
    await registry.refreshSymbols();
  });

  describe('main dex', () => {
    it('numbers a main-dex perp by its position in the universe', () => {
      expect(registry.getAssetId('BTC')).toBe(0);
      expect(registry.getAssetId('ETH')).toBe(1);
    });

    it('keeps the main dex below the builder range entirely', () => {
      // La frontière est à 100000 : un identifiant du dex principal ne doit
      // jamais y entrer, sans quoi les deux familles se recouvriraient.
      for (const name of ['BTC', 'ETH']) {
        expect(registry.getAssetId(name)).toBeLessThan(100000);
      }
    });
  });

  describe('HIP-3 dex', () => {
    it('offsets a HIP-3 perp by its dex index, not only by its own', () => {
      // `xyz` est le dex d'index 1 : 100000 + 1 × 10000 + 0.
      expect(registry.getAssetId('xyz:XYZ100')).toBe(110000);
      // Index 1 dans l'univers de `xyz`.
      expect(registry.getAssetId('xyz:AAPL')).toBe(110001);
    });

    it('gives each dex its own block of ten thousand', () => {
      // `mute` est le dex d'index 2 : son bloc commence à 120000. Deux dex ne
      // doivent jamais produire le même identifiant pour des positions égales.
      expect(registry.getAssetId('mute:FOO')).toBe(120000);
      expect(registry.getAssetId('mute:FOO')).not.toBe(
        registry.getAssetId('xyz:XYZ100'),
      );
    });

    it('never collides with a main-dex id, whatever the position', () => {
      // L'invariant qui rend l'encodage sûr : le plus petit identifiant HIP-3
      // reste très au-dessus du plus grand identifiant du dex principal.
      const mainIds = ['BTC', 'ETH'].map((n) => registry.getAssetId(n)!);
      const hip3Ids = ['xyz:XYZ100', 'xyz:AAPL', 'mute:FOO'].map(
        (n) => registry.getAssetId(n)!,
      );

      expect(Math.min(...hip3Ids)).toBeGreaterThan(Math.max(...mainIds));
    });

    it('matches the production registry, measured on 2026-10-08', () => {
      /**
       * Les trois valeurs relevées sur le gateway réel, rejouées sur la règle :
       * `xyz:MU` est à l'index 15 de l'univers `xyz` et vaut 110015,
       * `xyz:BRENTOIL` à l'index 49 et vaut 110049.
       *
       * Les fixtures ne portent que deux actifs `xyz`, donc on éprouve la règle
       * plutôt que de gonfler l'univers : l'identifiant d'un actif à l'index
       * `n` du dex 1 doit valoir `110000 + n`.
       */
      const xyzUniverse = PERP_BY_DEX['xyz'].universe;
      xyzUniverse.forEach((asset, index) => {
        expect(registry.getAssetId(asset.name)).toBe(110000 + index);
      });
    });
  });

  describe('spot', () => {
    it('numbers a spot pair in its own range, above the main dex', () => {
      // 10000 + index du marché spot. `PURR/USDC` est à l'index 0.
      expect(registry.getAssetId('PURR/USDC')).toBe(10000);
      expect(registry.getAssetId('HYPE/USDT')).toBe(10107);
    });

    it('keeps spot below the builder range', () => {
      // Spot occupe [10000, 100000[ : la frontière avec les dex HIP-3 ne doit
      // pas être franchie, et un index spot de 90000 serait déjà une anomalie.
      expect(registry.getAssetId('HYPE/USDT')).toBeLessThan(100000);
      expect(registry.getAssetId('HYPE/USDT')).toBeGreaterThanOrEqual(10000);
    });

    it('gives every alias of a spot market the same id', () => {
      // Un même marché s'enregistre sous plusieurs noms ; l'identifiant ne doit
      // pas dépendre du nom demandé, sans quoi un ordre partirait ailleurs
      // selon la façon de nommer la paire.
      expect(registry.getAssetId('@107')).toBe(
        registry.getAssetId('HYPE/USDT'),
      );
    });
  });

  describe('what it refuses', () => {
    it('has no id to offer for a market it never indexed', () => {
      // Le contrôleur en fait un 404 : mieux vaut cela qu'un `0`, qui est
      // l'identifiant **valide** de BTC.
      expect(registry.getAssetId('NOPE')).toBeUndefined();
    });

    it('forgets a market the exchange no longer serves after a resync', async () => {
      /**
       * Un actif retiré de l'univers ne doit pas rester adressable, et c'est
       * plus grave ici que pour le collatéral : un identifiant périmé ne rend
       * pas une réponse vide, il désigne la **position d'un autre marché**.
       *
       * Après le retrait de `xyz`, l'index 1 du dex principal appartient à un
       * autre actif — et c'est précisément le numéro que `xyz:AAPL` ne doit
       * plus pouvoir obtenir.
       */
      const shrunk = {
        ensureDexs: jest.fn().mockResolvedValue([null]),
        ensureSpotMeta: jest
          .fn()
          .mockResolvedValue({ tokens: [], universe: [] }),
        ensurePerpMeta: jest.fn().mockResolvedValue(perpMeta(['SOL'], 0)),
      };
      (registry as unknown as { metaCache: typeof shrunk }).metaCache = shrunk;

      await registry.refreshSymbols();

      expect(registry.getAssetId('SOL')).toBe(0);
      expect(registry.getAssetId('xyz:AAPL')).toBeUndefined();
      expect(registry.getAssetId('xyz:XYZ100')).toBeUndefined();
      expect(registry.getAssetId('HYPE/USDT')).toBeUndefined();
    });
  });
});
