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

  constructor(private readonly meta: MarketMetaCacheService) {}

  async onModuleInit() {
    await this.refreshSymbols();
    this.meta.onMetaUpdated$.subscribe(() => {
      this.logger.log('Meta refreshed — updating symbol maps...');
      this.refreshSymbols().catch((err) =>
        this.logger.error('Failed to refresh symbol maps', err),
      );
    });
  }

  /**
   * Refresh all symbol maps from Perp + Spot metadata.
   */
  private async refreshSymbols() {
    const perpMeta = await this.meta.ensurePerpMeta();
    const spotMeta = await this.meta.ensureSpotMeta();

    this.nameToAssetId.clear();
    this.nameToSzDecimals.clear();
    this.nameToSpotPairId.clear();

    this.buildPerpMaps(perpMeta);
    this.buildSpotMaps(spotMeta);
    // this.buildBuilderDexMaps(spotMeta);

    this.logger.log(
      `SymbolService updated: ${this.nameToAssetId.size} assets loaded.`,
    );
  }

  // --------------------------------------------------------
  // PERPETUALS
  // --------------------------------------------------------

  private buildPerpMaps(perpMetaData: HLPerpMeta) {
    perpMetaData.universe.forEach((asset, index) => {
      this.nameToAssetId.set(asset.name, index);
      this.nameToSzDecimals.set(asset.name, asset.szDecimals);
      this.assetIdToName.set(index, asset.name);
    });
  }

  // --------------------------------------------------------
  // SPOT
  // --------------------------------------------------------

  private buildSpotMaps(spotMetaData: HLSpotMeta): void {
    const tokenMap = new Map<number, { name: string; szDecimals: number }>();
    spotMetaData.tokens.forEach((token) => {
      tokenMap.set(token.index, {
        name: token.name,
        szDecimals: token.szDecimals,
      });
    });

    spotMetaData.universe.forEach((market) => {
      if (market.tokens.length < 2) return;
      const baseToken = tokenMap.get(market.tokens[0]);
      const quoteToken = tokenMap.get(market.tokens[1]);
      if (!baseToken || !quoteToken) return;

      // Hyperliquid réserve une plage d’IDs pour les marchés spot afin de ne pas les confondre avec les perps.
      const assetId = 10000 + market.index;
      const baseQuoteKey = `${baseToken.name}/${quoteToken.name}`;
      this.nameToAssetId.set(baseQuoteKey, assetId);
      this.nameToSzDecimals.set(baseQuoteKey, baseToken.szDecimals);
      this.nameToSpotPairId.set(baseQuoteKey, market.name);
      this.assetIdToName.set(assetId, baseQuoteKey);
    });
  }

  // --------------------------------------------------------
  // BUILDER DEX
  // --------------------------------------------------------
  /**
   * Builder Dex markets appear in Spot metadata under `tokens`,
   * not under `universe`. Example HL API format:
   *
   *   tokens: [
   *     { name: "test:ABC", assetId: 110000, szDecimals: 0 }
   *   ]
   */
  //   private buildBuilderDexMaps(spotMeta: HLSpotMeta) {
  //     for (const token of spotMeta.tokens) {
  //       if (!token.name.includes(':')) continue; // not a builder token

  //       this.nameToAssetId.set(token.name, token.assetId);
  //       this.nameToSzDecimals.set(token.name, token.szDecimals);
  //       // no spot pair ID for builder assets
  //     }
  //   }

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
