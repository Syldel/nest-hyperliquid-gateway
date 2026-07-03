import { Injectable } from '@nestjs/common';
import { HyperliquidApiPrivateInfoService } from './hyperliquid-api-private-info.service';
import {
  AccountAbstractionMode,
  DecimalString,
  HLClearinghouseState,
  HLSpotClearinghouseState,
} from '@syldel/hl-shared-types';
import { AssetRegistryService } from './asset-registry.service';

@Injectable()
export class HyperliquidCollateralService {
  private cache = {
    accountMode: null as {
      value: AccountAbstractionMode;
      expiresAt: number;
    } | null,
    perpState: {} as Record<
      string,
      { value: HLClearinghouseState; expiresAt: number }
    >,
    spotBalances: {} as Record<
      string,
      { value: HLSpotClearinghouseState; expiresAt: number }
    >,
  };

  private readonly MODE_TTL = 86400000; // 24 heures
  private readonly BALANCE_TTL = 10000; // 10 secondes

  constructor(
    private readonly assetRegistry: AssetRegistryService,
    private readonly privateInfoService: HyperliquidApiPrivateInfoService,
  ) {}

  /**
   * Récupère le mode d'abstraction du compte (Cache: 24h)
   */
  async getAccountMode(
    isTestnet: boolean = false,
  ): Promise<AccountAbstractionMode> {
    const now = Date.now();
    if (this.cache.accountMode && this.cache.accountMode.expiresAt > now) {
      return this.cache.accountMode.value;
    }

    const mode = await this.privateInfoService.getAccountMode(isTestnet);
    this.cache.accountMode = { value: mode, expiresAt: now + this.MODE_TTL };
    return mode;
  }

  /**
   * Récupère l'état du compte Perp (Cache: 10s)
   */
  private async getCachedPerpState(
    dex: string,
    isTestnet: boolean,
  ): Promise<HLClearinghouseState> {
    const cacheKey = `${isTestnet}-${dex}`;
    const now = Date.now();

    if (this.cache.perpState[cacheKey]?.expiresAt > now) {
      return this.cache.perpState[cacheKey].value;
    }

    const state = await this.privateInfoService.getPerpAccountState({
      dex,
      isTestnet,
    });
    this.cache.perpState[cacheKey] = {
      value: state,
      expiresAt: now + this.BALANCE_TTL,
    };
    return state;
  }

  /**
   * Récupère les soldes Spot (Cache: 10s)
   */
  private async getCachedSpotBalances(
    isTestnet: boolean,
  ): Promise<HLSpotClearinghouseState> {
    const cacheKey = `${isTestnet}`;
    const now = Date.now();

    if (this.cache.spotBalances[cacheKey]?.expiresAt > now) {
      return this.cache.spotBalances[cacheKey].value;
    }

    const balances = await this.privateInfoService.getSpotBalances(isTestnet);
    this.cache.spotBalances[cacheKey] = {
      value: balances,
      expiresAt: now + this.BALANCE_TTL,
    };
    return balances;
  }

  /**
   * Récupère le solde du collatéral requis pour trader un actif donné (Routage + Micro-cache).
   */
  async getCollateralBalance(
    asset: string,
    collateral?: string,
    isTestnet: boolean = false,
  ): Promise<{
    mode: AccountAbstractionMode;
    total: DecimalString;
    used: DecimalString;
    collateral: string;
  }> {
    const assetName = asset;
    const mode = await this.getAccountMode(isTestnet);

    const dex = this.assetRegistry.getDexForAsset(assetName);
    const dexLower = dex?.toLowerCase();

    let finalCollateral = collateral;
    if (!finalCollateral) {
      if (dexLower === 'hyna') finalCollateral = 'USDE';
      else if (dexLower === 'cash') finalCollateral = 'USDT';
      else finalCollateral = 'USDC';
    }
    const collateralUpper = finalCollateral.toUpperCase();

    // ─── L'EXCEPTION : MARCHÉ PERP EN MODE CLOISONNÉ ─────────────────────────
    if (
      mode !== 'unifiedAccount' &&
      mode !== 'portfolioMargin' &&
      this.assetRegistry.isPerp(assetName)
    ) {
      const perpState = await this.getCachedPerpState(dex, isTestnet);

      return {
        mode,
        collateral: collateralUpper,
        total: perpState?.marginSummary?.accountValue || '0',
        used: perpState?.marginSummary?.totalMarginUsed || '0',
      };
    }

    // ─── LE CAS GÉNÉRAL : UNIFIÉ OU MARCHÉ SPOT ──────────────────────────────
    const spotState = await this.getCachedSpotBalances(isTestnet);
    const targetBalance = spotState?.balances?.find(
      (b) => b.coin === collateralUpper,
    );

    return {
      mode,
      collateral: collateralUpper,
      total: targetBalance?.total || '0',
      used: targetBalance?.hold || '0',
    };
  }

  /**
   * Force la suppression du cache des balances.
   */
  clearBalanceCache(): void {
    this.cache.perpState = {};
    this.cache.spotBalances = {};
  }
}
