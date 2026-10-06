import { Injectable } from '@nestjs/common';
import {
  HLPerpMeta,
  HLSpotMeta,
  HLPerpMarketUniverse,
  HLSpotAssetSummary,
  HLPerpMetaAndCtx,
  HLPerpAssetCtx,
  CandleSnapshotRequest,
  CandleSnapshot,
  CandleInterval,
  HLPerpDex,
  HLPerpDexsResponse,
  HLPerpMarketExtended,
  HLL2BookResponse,
  HLNSigFigsOptions,
  HLMantissaOptions,
  HLFundingHistoryEntry,
  HLFundingHistoryRequest,
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
    dex: string = '',
    isTestnet: boolean = false,
  ): Promise<HLPerpMarketExtended[]> {
    const metaAndAssetCtxs = await this.executeInfo<HLPerpMetaAndCtx>(
      {
        type: 'metaAndAssetCtxs',
        dex,
      },
      isTestnet,
    );

    return this.buildMarkets(metaAndAssetCtxs);
  }

  private buildMarkets(metaAndCtx: HLPerpMetaAndCtx): HLPerpMarketExtended[] {
    const [meta, ctxs] = metaAndCtx;

    const toNumber = (v?: string | null): number | undefined =>
      v != null ? Number(v) : undefined;

    let ctx: HLPerpAssetCtx;
    return meta.universe.map((market, idx) => {
      ctx = ctxs[idx];

      const midPrice = toNumber(ctx?.midPx);
      const impactBidPrice = toNumber(ctx?.impactPxs?.[0]);
      const impactAskPrice = toNumber(ctx?.impactPxs?.[1]);

      // ===== DERIVED ONLY (no strategy logic) =====
      let estimatedSpreadBps: number | undefined;

      if (
        impactBidPrice != null &&
        impactAskPrice != null &&
        midPrice != null &&
        midPrice > 0
      ) {
        estimatedSpreadBps =
          ((impactAskPrice - impactBidPrice) / midPrice) * 10000;
      }

      return {
        index: idx,
        ...market,

        // ===== RAW NORMALIZED =====
        markPrice: ctx?.markPx,
        midPrice: ctx?.midPx,
        funding: ctx?.funding,
        openInterest: ctx?.openInterest,

        oraclePrice: ctx?.oraclePx,
        premium: ctx?.premium,
        dayNotionalVolume: ctx?.dayNtlVlm,
        prevDayPrice: ctx?.prevDayPx,

        impactBidPrice: ctx?.impactPxs?.[0],
        impactAskPrice: ctx?.impactPxs?.[1],

        // ===== DERIVED (gateway-safe) =====
        estimatedSpreadBps,
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

  /**
   * Récupère l'historique de funding d'un marché : un point **par heure**,
   * portant le taux réellement appliqué et la prime moyenne de cette heure.
   *
   * C'est, au 2026-10-06, le seul endpoint d'information qui rende une **série
   * temporelle** d'un champ de contexte de marché — il n'en existe aucun pour
   * l'intérêt ouvert ni pour les prix d'impact.
   *
   * ⚠️ Les paramètres sont **à plat** dans le corps, contrairement à
   * `candleSnapshot` qui imbrique les siens sous `req`. Deux endpoints voisins,
   * deux formes ; se tromper ici donne un appel refusé, pas une réponse vide.
   *
   * ⚠️ Cette route ne garde **rien** et ne déclenche **rien** : une requête
   * reçue vaut un appel à Hyperliquid. La fraîcheur appartient à l'appelant,
   * comme pour toutes les lectures d'exchange de ce gateway. Côté bot, le
   * funding ne changeant qu'à l'heure, demander plus d'une fois par heure ne
   * rapporte rien.
   *
   * ⚠️ Ce que le gateway ne fait pas, et qu'il ne faut pas lui faire faire :
   * filtrer les entrées à `"0.0"`. Ce zéro a **trois** significations qu'aucune
   * donnée de cette réponse ne distingue — marché délisté, marché vivant sur un
   * dex à multiplicateur nul (`flx`, `vntl`), ou heure réellement sans
   * financement. Les écarter effacerait l'information qui permet de trancher.
   * Voir l'en-tête de `HLFundingHistoryEntry`.
   *
   * @param req - `coin` (préfixe de dex compris), `startTime` en millisecondes
   *   et inclusif, `endTime` optionnel.
   * @returns Les entrées horaires, de la plus ancienne à la plus récente.
   */
  async getFundingHistory(
    req: HLFundingHistoryRequest,
  ): Promise<HLFundingHistoryEntry[]> {
    // `endTime` posé tel quel, y compris absent : `executeInfo` sérialise avec
    // `JSON.stringify`, qui **supprime** les clés valant `undefined`. Hyperliquid
    // le remplace alors par l'instant courant, ce qui est le comportement voulu.
    //
    // Il y avait ici un `if (req.endTime !== undefined)`. Une mutation a montré
    // qu'il ne changeait rien au corps envoyé : garder une garde qu'aucun test
    // ne peut distinguer, c'est inviter le prochain lecteur à croire qu'elle
    // protège quelque chose.
    const body: Record<string, unknown> = {
      type: 'fundingHistory',
      coin: req.coin,
      startTime: req.startTime,
      endTime: req.endTime,
    };

    return this.executeInfo<HLFundingHistoryEntry[]>(body);
  }

  /**
   * Récupère le snapshot du carnet d'ordres L2 pour un actif donné.
   * @param req - Objet contenant les paramètres de la requête :
   * - `coin`: Le nom du token (ex: "BTC")
   * - `nSigFigs`: (Optionnel) Agrégation des niveaux (2, 3, 4, 5, null)
   * - `mantissa`: (Optionnel) Autorisé uniquement si nSigFigs = 5 (1, 2, 5)
   * @returns Un objet `HLL2BookResponse` contenant les bids et les asks.
   */
  async getL2BookSnapshot(req: {
    coin: string;
    nSigFigs?: HLNSigFigsOptions;
    mantissa?: HLMantissaOptions;
  }): Promise<HLL2BookResponse> {
    const body: Record<string, any> = {
      type: 'l2Book',
      coin: req.coin,
    };

    if (req.nSigFigs !== undefined) {
      body.nSigFigs = req.nSigFigs;
    }

    if (req.mantissa !== undefined) {
      body.mantissa = req.mantissa;
    }

    return this.executeInfo<HLL2BookResponse>(body);
  }
}
