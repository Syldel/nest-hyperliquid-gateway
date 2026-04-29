import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MarketMetaCacheService } from './market-meta-cache.service';
import { HLPerpMeta, HLSpotMeta } from '@syldel/hl-shared-types';

@Injectable()
export class AssetRegistryService implements OnModuleInit {
  private readonly logger = new Logger(AssetRegistryService.name);

  // === Direct maps ===
  private nameToAssetId = new Map<string, number>();
  private nameToSzDecimals = new Map<string, number>();
  private nameToSpotPairId = new Map<string, string>();

  // === Reverse maps ===
  private assetIdToName = new Map<number, string>();

  constructor(private readonly metaCache: MarketMetaCacheService) {}

  async onModuleInit() {
    await this.refreshSymbols();
    this.metaCache.onMetaUpdated$.subscribe(() => {
      this.logger.log('Meta refreshed — updating symbol maps...');
      this.refreshSymbols().catch((err) =>
        this.logger.error('Failed to refresh symbol maps', err),
      );
    });
  }

  /**
   * Refresh all symbol maps from Perp + Spot metadata.
   */
  async refreshSymbols(testnet = false) {
    const dexs = await this.metaCache.ensureDexs(testnet);
    const spotMeta = await this.metaCache.ensureSpotMeta(testnet);

    this.clearMaps();

    this.buildSpotMaps(spotMeta);

    for (let i = 0; i < dexs.length; i++) {
      const dexName = dexs[i]?.name || '';

      const perpMeta = await this.metaCache.ensurePerpMeta(dexName, testnet);
      this.buildPerpMaps(perpMeta, i);
    }

    this.buildBuilderDexMaps(spotMeta);

    this.logger.log(
      `Registry synchronized: ${this.nameToAssetId.size} assets indexed across ${dexs.length} DEXs.`,
    );
  }

  // --------------------------------------------------------
  // PERPETUALS
  // --------------------------------------------------------

  private buildPerpMaps(perpMetaData: HLPerpMeta, dexIndex: number) {
    perpMetaData.universe.forEach((asset, indexInMeta) => {
      let assetId: number;

      if (dexIndex === 0) {
        // Main DEX : ID = Index dans l'univers (0, 1, 2...)
        assetId = indexInMeta;
      } else {
        // Builder DEX : 100000 + perp_dex_index * 10000 + index_in_meta
        assetId = 100000 + dexIndex * 10000 + indexInMeta;
      }

      this.register(asset.name, assetId, asset.szDecimals);
    });
  }

  // --------------------------------------------------------
  // SPOT
  // --------------------------------------------------------

  private buildSpotMaps(spotMetaData: HLSpotMeta): void {
    spotMetaData.universe.forEach((market) => {
      if (market.tokens.length < 2) return;

      const baseToken = spotMetaData.tokens[market.tokens[0]];
      const quoteToken = spotMetaData.tokens[market.tokens[1]];
      if (!baseToken || !quoteToken) return;

      // Hyperliquid réserve une plage d’IDs pour les marchés spot afin de ne pas les confondre avec les perps.
      const assetId = 10000 + market.index;
      const pairName = `${baseToken.name}/${quoteToken.name}`;

      this.register(pairName, assetId, baseToken.szDecimals);
      this.nameToSpotPairId.set(pairName, market.name);
    });
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

  private register(name: string, id: number, szDecimals: number) {
    this.nameToAssetId.set(name, id);
    this.nameToSzDecimals.set(name, szDecimals);
    this.assetIdToName.set(id, name);
  }

  private clearMaps() {
    this.nameToAssetId.clear();
    this.nameToSzDecimals.clear();
    this.nameToSpotPairId.clear();
    this.assetIdToName.clear();
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
