import { Injectable } from '@nestjs/common';
import {
  HLClearinghouseState,
  HLSpotClearinghouseState,
  HLPerpMeta,
  HLSpotMeta,
  HLPerpMarketUniverse,
  HLSpotAssetSummary,
  HLPerpMarket,
  HLPerpMetaAndCtx,
  HLOrderStatusResponse,
  HLPerpAssetCtx,
  HLOpenOrdersResponse,
  HLFrontendOpenOrdersResponse,
  HLUserFillsResponse,
  HLOid,
} from '@syldel/hl-shared-types';
import { HyperliquidConfigService } from '../config/hyperliquid-config.service';

@Injectable()
export class HyperliquidApiInfoService {
  private readonly API_URL = 'https://api.hyperliquid.xyz';
  private readonly TESTNET_API_URL = 'https://testnet.hyperliquid.xyz';

  constructor(private readonly config: HyperliquidConfigService) {}

  /**
   * Sélectionne l’URL API en fonction du réseau.
   */
  private getApiUrl(isTestnet: boolean): string {
    return isTestnet ? this.TESTNET_API_URL : this.API_URL;
  }

  /**
   * Méthode générique pour les requêtes /info.
   */
  private async executeInfo<T>(
    body: Record<string, unknown>,
    isTestnet: boolean = false,
  ): Promise<T> {
    const response = await fetch(`${this.getApiUrl(isTestnet)}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(
        `Hyperliquid /info error: HTTP ${response.status} – ${errorText}`,
      );
    }

    return (await response.json()) as T;
  }

  // ---------------------------------------------------------------------------
  // 📌 ROUTES /INFO SPÉCIFIQUES
  // ---------------------------------------------------------------------------

  /**
   * Récupère l'état du compte perpétuel.
   */
  async getPerpAccountState(
    isTestnet: boolean = false,
  ): Promise<HLClearinghouseState> {
    return this.executeInfo<HLClearinghouseState>(
      {
        type: 'clearinghouseState',
        user: this.config.accountAddress.toLowerCase(),
      },
      isTestnet,
    );
  }

  /**
   * Récupère les soldes Spot.
   */
  async getSpotBalances(
    isTestnet: boolean = false,
  ): Promise<HLSpotClearinghouseState> {
    return this.executeInfo<HLSpotClearinghouseState>(
      {
        type: 'spotClearinghouseState',
        user: this.config.accountAddress.toLowerCase(),
      },
      isTestnet,
    );
  }

  /**
   * Query the status of an order by order id (oid) or client order id (cloid).
   *
   * @param oid - Order id (uint64) or client order id (16-byte hex string).
   * @param isTestnet - Whether to query testnet (default: false).
   *
   * @returns The order status and full order details.
   *
   * @example
   * ```ts
   * const status = await client.getOrderStatus(
   *   '0x1234...',
   *   123456789,
   * );
   *
   * if (status.order.status === 'filled') {
   *   console.log('Order filled');
   * }
   * ```
   */
  async getOrderStatus(
    oid: HLOid,
    isTestnet: boolean = false,
  ): Promise<HLOrderStatusResponse> {
    return this.executeInfo<HLOrderStatusResponse>(
      {
        type: 'orderStatus',
        user: this.config.accountAddress.toLowerCase(),
        oid,
      },
      isTestnet,
    );
  }

  /**
   * Retrieve the user's currently open orders.
   *
   * This method returns the raw open orders as provided by Hyperliquid.
   * It only includes orders that are still active (not filled or canceled).
   *
   * @param dex Optional perp DEX name. Defaults to the primary perp DEX ("").
   *            Spot open orders are only included when using the primary perp DEX.
   * @param isTestnet Whether to use the Hyperliquid testnet.
   *
   * @returns A list of open orders currently active on the account.
   */
  async getOpenOrders(
    dex: string = '',
    isTestnet: boolean = false,
  ): Promise<HLOpenOrdersResponse> {
    return this.executeInfo<HLOpenOrdersResponse>(
      {
        type: 'openOrders',
        user: this.config.accountAddress.toLowerCase(),
        dex,
      },
      isTestnet,
    );
  }

  /**
   * Retrieve the user's currently open orders with additional frontend metadata.
   *
   * This method extends `getOpenOrders` by including extra fields such as
   * order type, reduce-only flag, trigger information, and position TP/SL markers.
   * It is recommended for trading bots and advanced order management logic.
   *
   * @param dex Optional perp DEX name. Defaults to the primary perp DEX ("").
   *            Spot open orders are only included when using the primary perp DEX.
   * @param isTestnet Whether to use the Hyperliquid testnet.
   *
   * @returns A list of enriched open orders with frontend-specific metadata.
   */
  async getFrontendOpenOrders(
    dex: string = '',
    isTestnet: boolean = false,
  ): Promise<HLFrontendOpenOrdersResponse> {
    return this.executeInfo<HLFrontendOpenOrdersResponse>(
      {
        type: 'frontendOpenOrders',
        user: this.config.accountAddress.toLowerCase(),
        dex,
      },
      isTestnet,
    );
  }

  /**
   * Retrieve the user's most recent fills.
   *
   * Returns up to 2000 of the most recent fills (spot and perp).
   * Intended for analytics, audit logs, and execution history.
   *
   * @param aggregateByTime Whether to aggregate partial fills by block/time.
   * @param isTestnet Whether to use the Hyperliquid testnet.
   */
  async getUserFills(
    aggregateByTime: boolean = false,
    isTestnet: boolean = false,
  ): Promise<HLUserFillsResponse> {
    return this.executeInfo<HLUserFillsResponse>(
      {
        type: 'userFills',
        user: this.config.accountAddress.toLowerCase(),
        aggregateByTime,
      },
      isTestnet,
    );
  }

  /**
   * Retrieve the user's fills within a given time range.
   *
   * Returns up to 2000 fills per request.
   * Only the 10,000 most recent fills are accessible.
   *
   * @param startTime Start timestamp (ms), inclusive.
   * @param endTime End timestamp (ms), inclusive. Defaults to now.
   * @param aggregateByTime Whether to aggregate partial fills by block/time.
   * @param isTestnet Whether to use the Hyperliquid testnet.
   */
  async getUserFillsByTime(
    startTime: number,
    endTime?: number,
    aggregateByTime: boolean = false,
    isTestnet: boolean = false,
  ): Promise<HLUserFillsResponse> {
    return this.executeInfo<HLUserFillsResponse>(
      {
        type: 'userFillsByTime',
        user: this.config.accountAddress.toLowerCase(),
        startTime,
        endTime,
        aggregateByTime,
      },
      isTestnet,
    );
  }

  // ---------------------------------------------------------------------------
  // 📌 PUBLIC ROUTES /INFO
  // ---------------------------------------------------------------------------

  /**
   * Récupère les métadonnées du marché perp.
   */
  async getPerpMarketMeta(isTestnet: boolean = false): Promise<HLPerpMeta> {
    return this.executeInfo<HLPerpMeta>({ type: 'meta' }, isTestnet);
  }

  /**
   * Récupère la liste complète des markets perp.
   * Quand on veut seulement les infos statiques du marché perp.
   */
  async getPerpAssets(
    meta: HLPerpMeta,
    isTestnet: boolean = false,
  ): Promise<HLPerpMarketUniverse[]> {
    if (!meta) {
      meta = await this.getPerpMarketMeta(isTestnet);
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
}
