import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { MarketMetaCacheService } from './market-meta-cache.service';
import { HLPerpMeta, HLSpotMeta } from '@syldel/hl-shared-types';

/**
 * Délai avant de retenter le chargement des symboles quand il échoue au
 * démarrage, doublé à chaque échec et plafonné. Le plancher (60 s) est au moins
 * égal à la première pause du garde-fou de débit : une tentative faite pendant
 * la pause serait de toute façon refusée localement.
 */
export const REGISTRY_RETRY_BASE_MS = 60_000;
export const REGISTRY_RETRY_MAX_MS = 15 * 60_000;

@Injectable()
export class AssetRegistryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssetRegistryService.name);

  private retryTimer: NodeJS.Timeout | null = null;
  private retryDelayMs = REGISTRY_RETRY_BASE_MS;

  // === Direct maps ===
  private nameToAssetId = new Map<string, number>();
  private nameToSzDecimals = new Map<string, number>();
  private nameToSpotPairId = new Map<string, string>();

  // === Reverse maps ===
  private assetIdToName = new Map<number, string>();
  private nameToDexName = new Map<string, string>();

  /**
   * Index du token qui sert de collatéral à chaque marché.
   *
   * Dérivé, jamais codé en dur : pour un perp c'est le `collateralToken` du
   * `meta` de son dex, pour une paire spot c'est son token de quote. Les trois
   * dépôts tenaient jusqu'ici une table `cash → USDT / hyna → USDE / sinon
   * USDC` qui ne couvrait que 2 des 10 dex déployés — et dont les deux entrées
   * désignent des dex éteints depuis juin et août 2026.
   *
   * Une absence n'a **pas** de valeur de repli : un marché dont le collatéral
   * n'a pas été résolu doit se dire, pas se deviner.
   */
  private nameToCollateralToken = new Map<string, number>();

  /** Symbole d'un token par son index — pour l'affichage, et pour rien d'autre. */
  private tokenIndexToSymbol = new Map<number, string>();

  constructor(private readonly metaCache: MarketMetaCacheService) {}

  async onModuleInit() {
    await this.loadSymbolsOrRetryLater();
    this.metaCache.onMetaUpdated$.subscribe(() => {
      this.logger.log('Meta refreshed — updating symbol maps...');
      this.refreshSymbols().catch((err) =>
        this.logger.error('Failed to refresh symbol maps', err),
      );
    });
  }

  onModuleDestroy() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  /**
   * Charge les symboles au démarrage **sans jamais faire échouer le
   * démarrage**.
   *
   * Ce chargement coûte à lui seul ~260 de poids sur 1200 par minute
   * (`perpDexs`, `spotMeta`, puis un `meta` par DEX : 11 DEX le 2026-09-21).
   * S'il échouait, l'exception remontait de `onModuleInit`, le démarrage de
   * Nest échouait et le processus s'arrêtait. Un hébergeur le relance aussitôt
   * (Docker double le délai en partant de 100 ms) : le gateway rappelait
   * Hyperliquid, échouait encore, et si l'échec était justement un refus de
   * débit, chaque relance aggravait la sanction. C'était le scénario de
   * bannissement le plus plausible de toute la chaîne.
   *
   * Désormais le processus reste debout, journalise l'échec et retente
   * lentement. Tant que les symboles manquent, les requêtes qui en dépendent
   * échouent avec une erreur explicite (`REGISTRY_ASSET_NOT_FOUND`...) : un
   * gateway dégradé et bavard vaut mieux qu'un gateway qui redémarre en boucle.
   */
  private async loadSymbolsOrRetryLater(): Promise<void> {
    try {
      await this.refreshSymbols();
      this.retryDelayMs = REGISTRY_RETRY_BASE_MS;
    } catch (error: unknown) {
      const delay = this.retryDelayMs;
      this.retryDelayMs = Math.min(delay * 2, REGISTRY_RETRY_MAX_MS);

      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Symbol registry could not be loaded (${message}). The gateway stays up; next attempt in ${delay / 1000}s.`,
      );

      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.loadSymbolsOrRetryLater();
      }, delay);
    }
  }

  /**
   * Refresh all symbol maps from Perp + Spot metadata.
   */
  async refreshSymbols(testnet = false) {
    const dexs = await this.metaCache.ensureDexs(testnet);
    const spotMeta = await this.metaCache.ensureSpotMeta(testnet);

    this.clearMaps();

    // Les symboles de token d'abord : le spot comme le perp y apparient leur
    // collatéral, et un index sans symbole ne s'affiche pas.
    this.buildTokenSymbols(spotMeta);
    this.buildSpotMaps(spotMeta);

    for (let i = 0; i < dexs.length; i++) {
      const dexName = dexs[i]?.name || '';

      const perpMeta = await this.metaCache.ensurePerpMeta(dexName, testnet);
      this.buildPerpMaps(perpMeta, i, dexName);
    }

    this.buildBuilderDexMaps(spotMeta);

    this.logger.log(
      `Registry synchronized: ${this.nameToAssetId.size} assets indexed across ${dexs.length} DEXs.`,
    );
  }

  // --------------------------------------------------------
  // PERPETUALS
  // --------------------------------------------------------

  private buildPerpMaps(
    perpMetaData: HLPerpMeta,
    dexIndex: number,
    dexName: string,
  ) {
    perpMetaData.universe.forEach((asset, indexInMeta) => {
      let assetId: number;

      if (dexIndex === 0) {
        // Main DEX : ID = Index dans l'univers (0, 1, 2...)
        assetId = indexInMeta;
      } else {
        // Builder DEX : 100000 + perp_dex_index * 10000 + index_in_meta
        assetId = 100000 + dexIndex * 10000 + indexInMeta;
      }

      this.register(asset.name, assetId, asset.szDecimals, dexName);

      // Tout le dex se règle dans le même token. Un `meta` qui ne le porterait
      // pas ne laisse rien à enregistrer : le collatéral sera dit introuvable,
      // jamais supposé USDC.
      if (perpMetaData.collateralToken !== undefined) {
        this.nameToCollateralToken.set(
          asset.name,
          perpMetaData.collateralToken,
        );
      }
    });
  }

  // --------------------------------------------------------
  // SPOT
  // --------------------------------------------------------

  HYPERUNIT_TOKENS = new Set(['UBTC', 'UETH', 'USOL']);

  /**
   * Registre de mapping pour les marchés au comptant (Spot).
   * Applique une exception de nommage sémantique exclusivement pour les jetons de la couche Hyperunit.
   */
  private buildSpotMaps(spotMetaData: HLSpotMeta): void {
    // ⚠️ Un token se retrouve par son `index`, **jamais** par sa position dans
    // le tableau. Les deux coïncident aujourd'hui et rien ne le garantit : une
    // paire appariée au mauvais token donnerait un collatéral faux, donc une
    // taille d'ordre calculée sur le solde d'un autre actif.
    const tokensByIndex = new Map(
      spotMetaData.tokens.map((token) => [token.index, token]),
    );

    spotMetaData.universe.forEach((market) => {
      if (market.tokens.length < 2) return;

      const baseToken = tokensByIndex.get(market.tokens[0]);
      const quoteToken = tokensByIndex.get(market.tokens[1]);
      if (!baseToken || !quoteToken) return;

      // 1. Calcul de l'ID d'Asset Spot protocolaire (10000 + index)
      const assetId = 10000 + market.index;

      // 2. Détermination du nom protocolaire EXACT (ex: "PURR/USDC", "@1", "@107")
      const protocolCoinName =
        market.index === 0 ? 'PURR/USDC' : `@${market.index}`;

      // 3. Récupération du nom L1 brut renvoyé par HyperCore (ex: "UBTC", "UETH", "USOL")
      const l1BaseName = baseToken.name;
      const quoteName = quoteToken.name;

      const officialPairName = `${l1BaseName}/${quoteName}`; // ex: "UBTC/USDC"

      /**
       * Un même marché s'enregistre sous plusieurs noms (protocolaire, L1,
       * alias Hyperunit) : ils doivent tous porter le même collatéral, sans
       * quoi la réponse dépendrait du nom par lequel on a demandé.
       *
       * Le collatéral d'une paire spot est son **token de quote** : c'est ce
       * qu'on dépense pour acheter la base. La doc le dit pour le compte
       * unifié — « USDT spot balance is the single source for CASH perps and
       * spot trading against USDT as a quote asset ».
       */
      const registerSpotName = (name: string) => {
        this.register(name, assetId, baseToken.szDecimals);
        this.nameToSpotPairId.set(name, market.name);
        this.nameToCollateralToken.set(name, quoteToken.index);
      };

      // --- ENREGISTREMENT 1 : Format Index Protocole (ex: "@1") ---
      registerSpotName(protocolCoinName);

      // --- ENREGISTREMENT 2 : Format L1 Officiel (ex: "UBTC/USDC") ---
      if (officialPairName !== protocolCoinName) {
        registerSpotName(officialPairName);
      }

      // --- ENREGISTREMENT 3 : Exception chirurgicale Hyperunit (ex: "BTC/USDC") ---
      // On n'applique le remapping que si le jeton fait explicitement partie du Set Hyperunit
      if (this.HYPERUNIT_TOKENS.has(l1BaseName)) {
        // On retire le "U" pour obtenir le nom humain conventionnel
        const cleanBaseName = l1BaseName.substring(1);
        const humanPairName = `${cleanBaseName}/${quoteName}`; // ex: "BTC/USDC", "ETH/USDC", "SOL/USDC"

        if (
          humanPairName !== officialPairName &&
          humanPairName !== protocolCoinName
        ) {
          registerSpotName(humanPairName);
        }

        // this.logger.debug(
        //   `[Hyperunit Exception] Remapped ${officialPairName} to human alias: "${humanPairName}" (AssetID: ${assetId})`,
        // );
      } else {
        // this.logger.debug(
        //   `[Spot Registry] Indexed Standard Asset ${assetId} | Protocol: "${protocolCoinName}" | L1: "${officialPairName}"`,
        // );
      }
    });
  }

  /**
   * Symbole de chaque token, par son index.
   *
   * Sert à nommer un collatéral à l'écran et dans un journal. **Pas** à
   * l'apparier : un solde se retrouve par `token`, pas par `coin` — deux
   * tokens peuvent porter le même symbole, aucun ne partage un index.
   */
  private buildTokenSymbols(spotMeta: HLSpotMeta): void {
    for (const token of spotMeta.tokens) {
      this.tokenIndexToSymbol.set(token.index, token.name);
    }
  }

  private buildBuilderDexMaps(spotMeta: HLSpotMeta) {
    for (const token of spotMeta.tokens) {
      // Indexation des tokens builder isolés (assetId >= 100,000)
      if (token.name.includes(':') || token.index >= 100_000) {
        // Note: l'ID ici est souvent l'index du token directement pour le spot
        this.register(token.name, token.index, token.szDecimals);
      }
    }
  }

  private register(
    name: string,
    id: number,
    szDecimals: number,
    dexName: string = '',
  ) {
    this.nameToAssetId.set(name, id);
    this.nameToSzDecimals.set(name, szDecimals);
    this.assetIdToName.set(id, name);
    this.nameToDexName.set(name, dexName);
  }

  private clearMaps() {
    this.nameToAssetId.clear();
    this.nameToSzDecimals.clear();
    this.nameToSpotPairId.clear();
    this.assetIdToName.clear();
    this.nameToDexName.clear();
    this.nameToCollateralToken.clear();
    this.tokenIndexToSymbol.clear();
  }

  // --------------------------------------------------------
  // PUBLIC API
  // --------------------------------------------------------

  getAssetName(assetId: number): string | undefined {
    return this.assetIdToName.get(assetId);
  }

  getAssetId(name: string): number | undefined {
    return this.nameToAssetId.get(name);
  }

  getSzDecimals(name: string): number | undefined {
    return this.nameToSzDecimals.get(name);
  }

  getSpotPairId(name: string): string | undefined {
    return this.nameToSpotPairId.get(name);
  }

  /**
   * L'index du token dans lequel ce marché se règle, ou `undefined` quand le
   * registre ne l'a pas résolu.
   *
   * `undefined` est une réponse à part entière : il dit « je ne sais pas », et
   * l'appelant doit le traiter comme tel. Rendre USDC par défaut est
   * exactement ce que ce registre remplace.
   */
  getCollateralToken(assetName: string): number | undefined {
    return this.nameToCollateralToken.get(assetName);
  }

  /** Le symbole d'un token, pour l'affichage. */
  getTokenSymbol(tokenIndex: number): string | undefined {
    return this.tokenIndexToSymbol.get(tokenIndex);
  }

  getDexForAsset(assetName: string): string {
    return this.nameToDexName.get(assetName) || '';
  }

  isSpot(name: string): boolean {
    return name.includes('/');
  }

  isBuilder(name: string): boolean {
    return name.includes(':');
  }

  isPerp(name: string): boolean {
    return !this.isSpot(name) && !this.isBuilder(name);
  }

  isSpotById(assetId: number): boolean {
    return assetId >= 10_000 && assetId < 100_000;
  }

  isPerpById(assetId: number): boolean {
    return assetId >= 0 && assetId < 10_000;
  }

  isBuilderById(assetId: number): boolean {
    return assetId >= 100_000;
  }
}
