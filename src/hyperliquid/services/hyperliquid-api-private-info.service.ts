import { Injectable } from '@nestjs/common';
import {
  HLClearinghouseState,
  HLSpotClearinghouseState,
  HLOrderStatusResponse,
  HLOpenOrdersResponse,
  HLFrontendOpenOrdersResponse,
  HLUserFillsResponse,
  HLOid,
  PortfolioResponse,
  HLUserFillsRequest,
  HLUserFillsByTimeRequest,
} from '@syldel/hl-shared-types';
import { UserContextService } from '../../auth/user-context.service';
import { HyperliquidApiBaseInfoService } from './hyperliquid-api-base-info.service';

@Injectable()
export class HyperliquidApiPrivateInfoService extends HyperliquidApiBaseInfoService {
  constructor(private readonly userContext: UserContextService) {
    super();
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
        user: this.userContext.walletAddress,
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
}
