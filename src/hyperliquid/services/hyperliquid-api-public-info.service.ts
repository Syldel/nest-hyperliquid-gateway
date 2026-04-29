import { Injectable } from '@nestjs/common';
import {
  HLPerpMeta,
  HLSpotMeta,
  HLPerpMarketUniverse,
  HLSpotAssetSummary,
  HLPerpMarket,
  HLPerpMetaAndCtx,
  HLPerpAssetCtx,
  CandleSnapshotRequest,
  CandleSnapshot,
  CandleInterval,
  HLPerpDex,
  HLPerpDexsResponse,
} from '@syldel/hl-shared-types';
import { HyperliquidApiBaseInfoService } from './hyperliquid-api-base-info.service';

@Injectable()
export class HyperliquidApiPublicInfoService extends HyperliquidApiBaseInfoService {
  // ---------------------------------------------------------------------------
  // 📌 PUBLIC MARKET/ASSET ROUTES /INFO
  // ---------------------------------------------------------------------------

  /**
   * Retrieves all perpetual DEXs metadata.
   * Filters out the null header returned by the Hyperliquid API.
   */
  async getAllPerpDexs(isTestnet: boolean = false): Promise<HLPerpDex[]> {
    const rawData = await this.executeInfo<HLPerpDexsResponse>(
      { type: 'perpDexs' },
      isTestnet,
    );

    if (!Array.isArray(rawData)) {
      return [];
    }

    return rawData.filter((item): item is HLPerpDex => item !== null);
  }

  /**
   * Retrieves perpetual market metadata (universe and margin tables).
   * @param dex Optional perp dex name (defaults to empty string for the main perp dex).
   * @param isTestnet Optional flag for testnet.
   */
  async getPerpMarketMeta(
    dex: string = '',
    isTestnet: boolean = false,
  ): Promise<HLPerpMeta> {
    return this.executeInfo<HLPerpMeta>(
      {
        type: 'meta',
        ...(dex ? { dex } : {}),
      },
      isTestnet,
    );
  }

  /**
   * Retrieves the complete list of perp markets (universe only).
   * * @param meta - Optional already fetched HLPerpMeta object to avoid redundant API calls.
   * @param dex - The perp dex name (defaults to empty string for the main dex).
   * @param isTestnet - Optional flag for testnet environment.
   */
  async getPerpAssets(
    meta?: HLPerpMeta,
    dex: string = '',
    isTestnet: boolean = false,
  ): Promise<HLPerpMarketUniverse[]> {
    if (!meta) {
      meta = await this.getPerpMarketMeta(dex, isTestnet);
    }

    return meta.universe.map((asset, index) => ({
      index,
      ...asset,
    }));
  }

  /**
   * Récupère les métadonnées Spot.
   */
  async getSpotMarketMeta(isTestnet: boolean = false): Promise<HLSpotMeta> {
    return this.executeInfo<HLSpotMeta>({ type: 'spotMeta' }, isTestnet);
  }

  /**
   * Récupère la liste complète des markets Spot et leurs décimales.
   */
  async getSpotAssets(
    meta: HLSpotMeta,
    isTestnet: boolean = false,
  ): Promise<HLSpotAssetSummary[]> {
    if (!meta) {
      meta = await this.getSpotMarketMeta(isTestnet);
    }

    return meta.universe.map((market) => {
      const baseTokenIndex = market.tokens[0];
      const baseToken = meta.tokens.find((t) => t.index === baseTokenIndex);

      return {
        ...market,
        szDecimals: baseToken?.szDecimals,
      };
    });
  }

  /**
   * Récupère la liste complète des marchés perpétuels Hyperliquid
   * ainsi que leurs données de prix en temps réel.
   *
   * Cette méthode appelle l'endpoint `metaAndAssetCtxs`, qui combine :
   * - les informations statiques des marchés (universe)
   * - les données dynamiques de marché (assetCtxs), incluant notamment :
   *   - markPx       : prix mark
   *   - midPx        : prix milieu du spread
   *   - oraclePx     : prix oracle
   *   - impactPxs    : prix estimés en cas d'ordre volumineux
   *   - openInterest : open interest du marché
   *   - funding      : taux de funding actuel
   *
   * Le tableau retourné contient un objet par marché, fusionnant :
   * - les infos statiques (name, szDecimals, maxLeverage, etc.)
   * - les infos dynamiques (markPx, oraclePx, etc.)
   *
   * @returns {Promise<HLPerpMarket[]>}
   * Une liste de marchés perpétuels enrichis avec leurs prix du moment.
   *
   * @example
   * const markets = await this.getPerpMarketsWithPrices();
   * const eth = markets.find(m => m.name === 'ETH');
   * console.log(eth.markPrice);
   *
   * @description
   * Cette méthode est généralement utilisée pour :
   * - calculer la taille d'un ordre (nécessite markPx)
   * - afficher l'état du marché (prix, funding...)
   * - initialiser des stratégies de trading.
   */
  async getPerpMarketsWithPrices(
    isTestnet: boolean = false,
  ): Promise<HLPerpMarket[]> {
    const metaAndAssetCtxs = await this.executeInfo<HLPerpMetaAndCtx>(
      {
        type: 'metaAndAssetCtxs',
      },
      isTestnet,
    );

    return this.buildMarkets(metaAndAssetCtxs);
  }

  private buildMarkets(metaAndCtx: HLPerpMetaAndCtx): HLPerpMarket[] {
    const [meta, ctxs] = metaAndCtx;

    let ctx: HLPerpAssetCtx;
    return meta.universe.map((market, idx) => {
      ctx = ctxs[idx];

      return {
        index: idx,
        ...market,
        markPrice: ctx?.markPx,
        midPrice: ctx?.midPx,
        funding: ctx?.funding,
        openInterest: ctx?.openInterest,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // 📌 VARIOUS PUBLIC ROUTES /INFO
  // ---------------------------------------------------------------------------

  /**
   * Récupère l'historique des bougies (max 5000) pour un actif donné.
   * * @param req - Objet contenant les paramètres de la requête :
   * - `coin`: Le nom du token (ex: "BTC" ou "xyz:XYZ100")
   * - `interval`: L'unité de temps (ex: "15m", "1h", "1d")
   * - `startTime`: Timestamp de début en millisecondes
   * - `endTime`: (Optionnel) Timestamp de fin en millisecondes
   * * @returns Un tableau d'objets `CandleSnapshot` représentant les bougies OHLCV.
   */
  async getCandleSnapshot(req: {
    coin: string;
    interval: CandleInterval;
    startTime: number;
    endTime?: number;
  }): Promise<CandleSnapshot[]> {
    const body: { type: string; req: CandleSnapshotRequest } = {
      type: 'candleSnapshot',
      req: {
        coin: req.coin,
        interval: req.interval,
        startTime: req.startTime,
        endTime: req.endTime,
      },
    };

    return this.executeInfo<CandleSnapshot[]>(body);
  }
}
