import { Injectable } from '@nestjs/common';
import {
  HLClearinghouseState,
  HLSpotClearinghouseState,
  HLOrderStatusResponse,
  HLOrderStatusData,
  HLOpenOrdersResponse,
  HLFrontendOpenOrdersResponse,
  HLUserFillsResponse,
  HLOid,
  PortfolioResponse,
  HLUserFillsRequest,
  HLUserFillsByTimeRequest,
  HlActiveAssetData,
  AccountAbstractionMode,
  HlUserFees,
} from '@syldel/hl-shared-types';
import { UserContextService } from '../../auth/user-context.service';
import { HyperliquidApiBaseInfoService } from './hyperliquid-api-base-info.service';
import { HyperliquidRateGuardService } from './hyperliquid-rate-guard.service';
import { GetActiveAssetDataQueryDto } from '../dtos/hyperliquid-info.query.dto';

@Injectable()
export class HyperliquidApiPrivateInfoService extends HyperliquidApiBaseInfoService {
  constructor(
    private readonly userContext: UserContextService,
    rateGuard: HyperliquidRateGuardService,
  ) {
    super(rateGuard);
  }

  // ---------------------------------------------------------------------------
  // 📌 ROUTES /INFO SPÉCIFIQUES
  // ---------------------------------------------------------------------------

  /**
   * Récupère l'état du compte perpétuel pour un DEX spécifique.
   */
  async getPerpAccountState(
    params: {
      isTestnet?: boolean;
      dex?: string;
    } = {},
  ): Promise<HLClearinghouseState> {
    const { isTestnet = false, dex } = params;

    return this.executeInfo<HLClearinghouseState>(
      {
        type: 'clearinghouseState',
        user: this.userContext.walletAddress,
        ...(dex && { dex }),
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
        user: this.userContext.walletAddress,
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
        user: this.userContext.walletAddress,
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
        user: this.userContext.walletAddress,
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
        user: this.userContext.walletAddress,
        dex,
      },
      isTestnet,
    );
  }

  /**
   * Retrieve the user's order history: up to the 2000 most recent records, each with the state it ended in.
   *
   * ⚠️ **One record per state an order went through**, not one per order: an order cancelled after resting appears
   * twice (`open`, then `canceled`). Measured on 2026-10-26: 1 854 records for 1 051 distinct orders. The weight is
   * counted on the records: 20, plus 1 per 20 returned (at most 120). `executeInfo` records it after the response,
   * which is what the rate guard needs to know about this call.
   *
   * Position-level TP/SL (`isPositionTpsl: true`) appear here with their size written `0.0` while armed.
   *
   * @param isTestnet Whether to use the Hyperliquid testnet.
   */
  async getHistoricalOrders(
    isTestnet: boolean = false,
  ): Promise<HLOrderStatusData[]> {
    return this.executeInfo<HLOrderStatusData[]>(
      {
        type: 'historicalOrders',
        user: this.userContext.walletAddress,
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
   * @param request Request parameters.
   * @param isTestnet Whether to use the Hyperliquid testnet.
   */
  async getUserFills(
    request: HLUserFillsRequest = {},
    isTestnet: boolean = false,
  ): Promise<HLUserFillsResponse> {
    return this.executeInfo<HLUserFillsResponse>(
      {
        type: 'userFills',
        user: this.userContext.walletAddress,
        ...(request as Record<string, unknown>),
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
   * @param request Request parameters.
   * @param isTestnet Whether to use the Hyperliquid testnet.
   */
  async getUserFillsByTime(
    request: HLUserFillsByTimeRequest,
    isTestnet: boolean = false,
  ): Promise<HLUserFillsResponse> {
    return this.executeInfo<HLUserFillsResponse>(
      {
        type: 'userFillsByTime',
        user: this.userContext.walletAddress,
        ...(request as unknown as Record<string, unknown>),
      },
      isTestnet,
    );
  }

  /**
   * Récupère l'historique du portfolio (PnL, Valeur, Volume).
   * @returns Un tableau de données indexé par période (day, week, allTime, etc.)
   */
  async getUserPortfolio(): Promise<PortfolioResponse> {
    return this.executeInfo<PortfolioResponse>({
      type: 'portfolio',
      user: this.userContext.walletAddress,
    });
  }

  /**
   * Récupère le barème de frais de l'utilisateur.
   *
   * `userCrossRate` et `userAddRate` sont **son** taux, déjà net de son palier
   * de volume sur 14 jours et de sa remise de staking HYPE — mais pas de sa
   * remise de parrainage (`activeReferralDiscount`, que la formule officielle
   * applique à part), ni du barème propre à un marché HIP-3.
   *
   * ⚠️ Les deux ne portent **pas** les noms du pseudo-code de la page des frais,
   * qui écrit `fees: { makerRate, takerRate }`. Le point de terminaison ne
   * connaît ni l'un ni l'autre : `cross` prend la liquidité, `add` l'apporte.
   *
   * Le barème est réévalué à la fin de chaque jour UTC, donc la réponse n'a pas
   * besoin d'être fraîche à la minute — un appelant qui la lit souvent devrait
   * la garder.
   */
  async getUserFees(isTestnet: boolean = false): Promise<HlUserFees> {
    return this.executeInfo<HlUserFees>(
      {
        type: 'userFees',
        user: this.userContext.walletAddress,
      },
      isTestnet,
    );
  }

  /**
   * Récupère les données de l'actif actif de l'utilisateur (levier, tailles max, disponible).
   */
  async getActiveAssetData(
    query: GetActiveAssetDataQueryDto,
  ): Promise<HlActiveAssetData> {
    return this.executeInfo<HlActiveAssetData>({
      type: 'activeAssetData',
      user: this.userContext.walletAddress,
      coin: query.coin,
    });
  }

  /**
   * Récupère le mode d'abstraction du compte (unifiedAccount, portfolioMargin, disabled, etc.).
   */
  async getAccountMode(
    isTestnet: boolean = false,
  ): Promise<AccountAbstractionMode> {
    return this.executeInfo<AccountAbstractionMode>(
      {
        type: 'userAbstraction',
        user: this.userContext.walletAddress,
      },
      isTestnet,
    );
  }
}
