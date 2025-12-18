import { Injectable } from '@nestjs/common';

import {
  HLOrderDetails,
  HLParams,
  HLSuccessResponse,
  HLCancelResponse,
  HLErrorResponse,
  HLTwapOrderAction,
  HLTwapCancelAction,
  HLReserveRequestWeightAction,
  HLApproveAgentAction,
  HLApproveBuilderFeeAction,
  HLCDepositAction,
  HLCWithdrawAction,
  HLVaultTransferAction,
  HLSpotSendAction,
  HLUpdateLeverageAction,
  HLUpdateIsolatedMarginAction,
  HLCancelAction,
  HLCancelByCloidAction,
  HLModifyAction,
  HLBatchModifyAction,
  HLOrderAction,
  HLUsdClassTransferAction,
  HLApiOrder,
  HLOrderGrouping,
  HLOrderBuilder,
} from '../interfaces';
import { HyperliquidConfigService } from '../config/hyperliquid-config.service';
import { NonceManagerService } from '../../crypto/services/nonce-manager.service';
import { ValueFormatterService } from './value-formatter.service';
import { AssetRegistryService } from './asset-registry.service';
import { SigningService } from '../../crypto/services/signing.service';
import { WalletService } from '../../crypto/services/wallet.service';

@Injectable()
export class HyperliquidApiTradeService {
  private readonly API_URL = 'https://api.hyperliquid.xyz';
  private readonly TESTNET_API_URL = 'https://testnet.hyperliquid.xyz';
  private readonly MAX_RETRIES = 1;
  private readonly RETRY_DELAY_MS = 3000;

  constructor(
    private readonly nonceManager: NonceManagerService,
    private readonly config: HyperliquidConfigService,
    private readonly formatter: ValueFormatterService,
    private readonly assetRegistry: AssetRegistryService,
    private readonly signingService: SigningService,
    private readonly walletService: WalletService,
  ) {
    this.walletService.createFromPrivateKey(this.config.agentPrivateKey);
  }

  private getApiUrl(isTestnet: boolean): string {
    return isTestnet ? this.TESTNET_API_URL : this.API_URL;
  }

  /**
   * Méthode générique pour les requêtes nécessitant un nonce
   */
  private async executeWithNonce<T extends { type: string }, R>(
    endpoint: string,
    action: T,
    isTestnet: boolean = false,
  ): Promise<R> {
    let nonce: number | undefined;
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        // 1. Acquérir un nonce
        nonce = this.nonceManager.getTimestamp();

        // 2. Signer l'action
        const signature = await this.signingService.signL1Action({
          wallet: this.walletService.wallet,
          action,
          nonce,
          // vaultAddress: null,
          // expiresAfter: 0,
          isTestnet,
        });

        // 3. Préparer les paramètres complets
        const params: HLParams<T> = {
          action,
          nonce,
          signature,
          // vaultAddress: null,
          // expiresAfter: 0,
        };

        // 4. Exécuter la requête
        const response = await fetch(
          `${this.getApiUrl(isTestnet)}/${endpoint}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
          },
        );

        if (!response.ok) {
          const errorData: unknown = await response.json().catch(() => ({}));
          if ((errorData as HLErrorResponse).message) {
            throw new Error(
              `Hyperliquid API error: ${(errorData as HLErrorResponse).message}`,
            );
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = (await response.json()) as R;
        return result;
      } catch (error) {
        lastError = error;

        if (attempt < this.MAX_RETRIES) {
          // Backoff exponentiel
          const delay = this.RETRY_DELAY_MS * 2 ** (attempt - 1);
          console.log(
            `Retry ${attempt}/${this.MAX_RETRIES} for ${endpoint} in ${delay}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          console.error(`Max retries reached for ${endpoint}`);
          throw lastError;
        }
      }
    }

    // Devrait être inatteignable
    throw new Error('Unreachable code in executeWithNonce');
  }

  /**
   * Méthode pour les requêtes sans nonce
   */
  private async executeWithoutNonce<T, R>(
    endpoint: string,
    data: T,
    isTestnet: boolean = false,
  ): Promise<R> {
    const response = await fetch(`${this.getApiUrl(isTestnet)}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData: unknown = await response.json().catch(() => ({}));
      if ((errorData as HLErrorResponse).message) {
        throw new Error(
          `Hyperliquid API error: ${(errorData as HLErrorResponse).message}`,
        );
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json() as Promise<R>;
  }

  /**
   * Generate a Client Order ID (cloid) suitable for Hyperliquid orders.
   * - Optional 128-bit hexadecimal string.
   * - Example: "0x1234567890abcdef1234567890abcdef"
   */
  generateCloid(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));

    return (
      '0x' +
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    );
  }

  /**
   * Convertit un HLOrderDetails en format attendu par l'API Hyperliquid.
   * @param order - L'ordre avec les clés longues (asset, isBuy, limitPx, etc.)
   * @returns Objet avec les clés abrégées pour l'API (a, b, p, s, r, t, c)
   */
  private convertToApiOrder(order: HLOrderDetails) {
    const assetId = this.assetRegistry.getAssetId(order.assetName);
    if (assetId === undefined) {
      throw new Error(`Unknown asset: ${order.assetName}`);
    }

    const szDecimals = this.assetRegistry.getSzDecimals(order.assetName);
    if (szDecimals === undefined) {
      throw new Error(`Unknown szDecimals for: ${order.assetName}`);
    }

    const isPerp = this.assetRegistry.isPerpById(assetId);

    // 👉 Formatage Hyperliquid (sig figs, decimals rules, too-small checks…)
    const formattedPrice = this.formatter.formatPrice(
      order.limitPx,
      szDecimals,
      isPerp ? 'perp' : 'spot',
    );

    const formattedSize = this.formatter.formatSize(order.sz, szDecimals);

    const apiOrder: HLApiOrder = {
      a: assetId,
      b: !!order.isBuy,
      p: formattedPrice, // order.limitPx,
      s: formattedSize, // order.sz,
      r: !!order.reduceOnly,
      t: order.orderType,
    };

    if (order.cloid) {
      apiOrder.c = order.cloid;
    }

    return apiOrder;
  }

  // =============================================
  // Méthodes pour les ordres
  // =============================================

  /**
   * Place un ordre sur Hyperliquid.
   */
  async placeOrder(
    order: HLOrderDetails,
    grouping: HLOrderGrouping = 'na',
    builder?: HLOrderBuilder,
    isTestnet: boolean = false,
  ): Promise<HLSuccessResponse> {
    return await this.placeOrders([order], grouping, builder, isTestnet);
  }

  /**
   * Place des ordres sur Hyperliquid.
   */
  async placeOrders(
    orders: HLOrderDetails[],
    grouping: HLOrderGrouping = 'na',
    builder?: HLOrderBuilder,
    isTestnet: boolean = false,
  ): Promise<HLSuccessResponse> {
    const apiOrders: HLApiOrder[] = orders.map((order) => {
      // order.cloid = this.generateCloid();
      return this.convertToApiOrder(order);
    });

    const action: HLOrderAction = {
      type: 'order',
      orders: apiOrders,
      grouping,
    };

    if (builder) {
      action.builder = builder;
    }

    return this.executeWithNonce<HLOrderAction, HLSuccessResponse>(
      'exchange',
      action,
      isTestnet,
    );
  }

  /**
   * Modifie un ordre existant.
   */
  async modifyOrder(
    oid: number | string,
    order: HLOrderDetails,
    isTestnet: boolean = false,
  ): Promise<HLSuccessResponse> {
    const action: HLModifyAction = {
      type: 'modify',
      oid,
      order,
    };

    return this.executeWithNonce<HLModifyAction, HLSuccessResponse>(
      'exchange',
      action,
      isTestnet,
    );
  }

  /**
   * Modifie plusieurs ordres en une seule requête.
   */
  async batchModifyOrders(
    modifies: Array<{ oid: number | string; order: HLOrderDetails }>,
    isTestnet: boolean = false,
  ): Promise<HLSuccessResponse> {
    const action: HLBatchModifyAction = {
      type: 'batchModify',
      modifies,
    };

    return this.executeWithNonce<HLBatchModifyAction, HLSuccessResponse>(
      'exchange',
      action,
      isTestnet,
    );
  }

  // =============================================
  // Méthodes pour les annulations
  // =============================================

  /**
   * Annule un ou plusieurs ordres par OID.
   */
  async cancelOrder(
    cancels: Array<{ a: number; o: number }>,
    isTestnet: boolean = false,
  ): Promise<HLCancelResponse> {
    const action: HLCancelAction = {
      type: 'cancel',
      cancels,
    };

    return this.executeWithNonce<HLCancelAction, HLCancelResponse>(
      'exchange',
      action,
      isTestnet,
    );
  }

  /**
   * Annule un ordre par CLOID.
   */
  async cancelOrderByCloid(
    cancels: Array<{ asset: number; cloid: string }>,
    isTestnet: boolean = false,
  ): Promise<HLSuccessResponse> {
    const action: HLCancelByCloidAction = {
      type: 'cancelByCloid',
      cancels,
    };

    return this.executeWithNonce<HLCancelByCloidAction, HLSuccessResponse>(
      'exchange',
      action,
      isTestnet,
    );
  }

  // =============================================
  // Méthodes pour la gestion des positions
  // =============================================

  /**
   * Met à jour le levier d'une position.
   */
  async updateLeverage(
    asset: number,
    isCross: boolean,
    leverage: number,
    isTestnet: boolean = false,
  ): Promise<HLSuccessResponse> {
    const action: HLUpdateLeverageAction = {
      type: 'updateLeverage',
      asset,
      isCross,
      leverage,
    };

    return this.executeWithNonce<HLUpdateLeverageAction, HLSuccessResponse>(
      'exchange',
      action,
      isTestnet,
    );
  }

  /**
   * Met à jour la marge isolée d'une position.
   */
  async updateIsolatedMargin(
    asset: number,
    isBuy: boolean,
    ntli: number,
    isTestnet: boolean = false,
  ): Promise<HLSuccessResponse> {
    const action: HLUpdateIsolatedMarginAction = {
      type: 'updateIsolatedMargin',
      asset,
      isBuy,
      ntli,
    };

    return this.executeWithNonce<
      HLUpdateIsolatedMarginAction,
      HLSuccessResponse
    >('exchange', action, isTestnet);
  }

  // =============================================
  // Méthodes pour les transferts
  // =============================================

  /**
   * Envoie des USDC à une autre adresse.
   */
  // async sendUsd(
  //   signatureChainId: string,
  //   destination: string,
  //   amount: string,
  //   isTestnet: boolean = false,
  // ): Promise<HLSuccessResponse> {
  //   const hyperliquidChain = isTestnet ? 'Testnet' : 'Mainnet';
  //   const action: HLUsdSendAction = {
  //     type: 'usdSend',
  //     hyperliquidChain,
  //     signatureChainId,
  //     destination,
  //     amount,
  //     time: Date.now(),
  //   };

  //   return this.executeWithNonce<HLUsdSendAction, HLSuccessResponse>(
  //     'exchange',
  //     action,
  //     isTestnet,
  //   );
  // }

  /**
   * Transfère des USDC entre comptes spot et perp.
   */
  async transferUsdClass(
    amount: string,
    toPerp: boolean,
    isTestnet: boolean = false,
  ): Promise<HLSuccessResponse> {
    const hyperliquidChain = isTestnet ? 'Testnet' : 'Mainnet';
    const signatureChainId = '0xa4b1'; // doit correspondre à la chaîne de ton wallet (ex: Arbitrum mainnet)
    const nonce = this.nonceManager.getTimestamp();
    const action: HLUsdClassTransferAction = {
      type: 'usdClassTransfer',
      hyperliquidChain,
      signatureChainId,
      amount,
      toPerp,
      nonce,
    };

    const result = await this.executeWithNonce<
      HLUsdClassTransferAction,
      HLSuccessResponse
    >('exchange', action, isTestnet);
    return result;
  }

  /**
   * Envoie des actifs spot.
   */
  async sendSpotAsset(
    signatureChainId: string,
    destination: string,
    token: string,
    amount: string,
    isTestnet: boolean = false,
  ): Promise<HLSuccessResponse> {
    const hyperliquidChain = isTestnet ? 'Testnet' : 'Mainnet';
    const action: HLSpotSendAction = {
      type: 'spotSend',
      hyperliquidChain,
      signatureChainId,
      destination,
      token,
      amount,
      time: Date.now(),
    };

    return this.executeWithNonce<HLSpotSendAction, HLSuccessResponse>(
      'exchange',
      action,
      isTestnet,
    );
  }

  // =============================================
  // Méthodes pour le staking
  // =============================================

  /**
   * Dépose dans le staking.
   */
  async depositIntoStaking(
    signatureChainId: string,
    wei: number,
    isTestnet: boolean = false,
  ): Promise<HLSuccessResponse> {
    const hyperliquidChain = isTestnet ? 'Testnet' : 'Mainnet';
    const nonce = this.nonceManager.getTimestamp();
    const action: HLCDepositAction = {
      type: 'cDeposit',
      hyperliquidChain,
      signatureChainId,
      wei,
      nonce,
    };

    const result = await this.executeWithNonce<
      HLCDepositAction,
      HLSuccessResponse
    >('exchange', action, isTestnet);
    return result;
  }

  /**
   * Retire du staking.
   */
  async withdrawFromStaking(
    signatureChainId: string,
    wei: number,
    isTestnet: boolean = false,
  ): Promise<HLSuccessResponse> {
    const hyperliquidChain = isTestnet ? 'Testnet' : 'Mainnet';
    const nonce = this.nonceManager.getTimestamp();
    const action: HLCWithdrawAction = {
      type: 'cWithdraw',
      hyperliquidChain,
      signatureChainId,
      wei,
      nonce,
    };

    const result = await this.executeWithNonce<
      HLCWithdrawAction,
      HLSuccessResponse
    >('exchange', action, isTestnet);
    return result;
  }

  // =============================================
  // Méthodes pour les ordres TWAP
  // =============================================

  /**
   * Place un ordre TWAP.
   */
  async placeTwapOrder(
    asset: number,
    isBuy: boolean,
    size: string,
    reduceOnly: boolean,
    minutes: number,
    isTpsl: boolean,
    isTestnet: boolean = false,
  ): Promise<HLSuccessResponse> {
    const action: HLTwapOrderAction = {
      type: 'twapOrder',
      twap: {
        a: asset,
        b: isBuy,
        s: size,
        r: reduceOnly,
        m: minutes,
        t: isTpsl,
      },
    };

    return this.executeWithNonce<HLTwapOrderAction, HLSuccessResponse>(
      'exchange',
      action,
      isTestnet,
    );
  }

  /**
   * Annule un ordre TWAP.
   */
  async cancelTwapOrder(
    asset: number,
    twapId: number,
    isTestnet: boolean = false,
  ): Promise<HLSuccessResponse> {
    const action: HLTwapCancelAction = {
      type: 'twapCancel',
      a: asset,
      t: twapId,
    };

    return this.executeWithNonce<HLTwapCancelAction, HLSuccessResponse>(
      'exchange',
      action,
      isTestnet,
    );
  }

  // =============================================
  // Méthodes pour les requêtes sans nonce
  // =============================================

  /**
   * Réserve des actions supplémentaires.
   */
  async reserveAdditionalActions(
    weight: number,
    isTestnet: boolean = false,
  ): Promise<HLSuccessResponse> {
    const action: HLReserveRequestWeightAction = {
      type: 'reserveRequestWeight',
      weight,
    };

    return this.executeWithNonce<
      HLReserveRequestWeightAction,
      HLSuccessResponse
    >('exchange', action, isTestnet);
  }

  /**
   * Approuve un wallet API.
   */
  async approveAgent(
    signatureChainId: string,
    agentAddress: string,
    agentName?: string,
    isTestnet: boolean = false,
  ): Promise<HLSuccessResponse> {
    const hyperliquidChain = isTestnet ? 'Testnet' : 'Mainnet';
    const nonce = this.nonceManager.getTimestamp();
    const action: HLApproveAgentAction = {
      type: 'approveAgent',
      hyperliquidChain,
      signatureChainId,
      agentAddress,
      agentName,
      nonce,
    };

    const result = await this.executeWithNonce<
      HLApproveAgentAction,
      HLSuccessResponse
    >('exchange', action, isTestnet);
    return result;
  }

  /**
   * Approuve un frais de builder.
   */
  async approveBuilderFee(
    signatureChainId: string,
    maxFeeRate: string,
    builder: string,
    isTestnet: boolean = false,
  ): Promise<HLSuccessResponse> {
    const hyperliquidChain = isTestnet ? 'Testnet' : 'Mainnet';
    const nonce = this.nonceManager.getTimestamp();
    const action: HLApproveBuilderFeeAction = {
      type: 'approveBuilderFee',
      hyperliquidChain,
      signatureChainId,
      maxFeeRate,
      builder,
      nonce,
    };

    const result = await this.executeWithNonce<
      HLApproveBuilderFeeAction,
      HLSuccessResponse
    >('exchange', action, isTestnet);
    return result;
  }

  /**
   * Transfère des fonds vers/d'un vault.
   */
  async vaultTransfer(
    vaultAddress: string,
    isDeposit: boolean,
    usd: number,
    isTestnet: boolean = false,
  ): Promise<HLSuccessResponse> {
    const action: HLVaultTransferAction = {
      type: 'vaultTransfer',
      vaultAddress,
      isDeposit,
      usd,
    };

    return this.executeWithNonce<HLVaultTransferAction, HLSuccessResponse>(
      'exchange',
      action,
      isTestnet,
    );
  }
}
