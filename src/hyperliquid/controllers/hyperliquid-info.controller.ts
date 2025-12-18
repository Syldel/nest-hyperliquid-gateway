import { Controller, Get, Query } from '@nestjs/common';
import { HyperliquidApiInfoService } from '../services/hyperliquid-api-info.service';
import { MarketMetaCacheService } from '../services/market-meta-cache.service';

@Controller('hyperliquid/info')
export class HyperliquidInfoController {
  constructor(
    private readonly infoService: HyperliquidApiInfoService,
    private readonly cache: MarketMetaCacheService,
  ) {}

  /**
   * Convertit un paramètre de query en booléen pour savoir si on utilise le testnet.
   * Exemple : /hyperliquid/info/perp-account?testnet=true
   */
  private castTestnetFlag(value?: string): boolean {
    return value === 'true' || value === '1';
  }

  // ---------------------------------------------------------------------------
  // 📌 PERP — ROUTES D'INFORMATION
  // ---------------------------------------------------------------------------

  /**
   * Renvoie l'état du compte perp (margin, positions, withdrawable, etc.)
   *
   * (type: 'clearinghouseState')
   */
  @Get('perp-account')
  async getPerpAccountState(@Query('testnet') testnet?: string) {
    const isTestnet = this.castTestnetFlag(testnet);
    return this.infoService.getPerpAccountState(isTestnet);
  }

  /**
   * Renvoie la metadata des marchés perp :
   * - universe (nom, decimals, leverage…)
   * - margin tables
   *
   * Si on n'a pas besoin de "margin tables" on peut utliser directement 'perp-assets' (getPerpAssets)
   * (type: 'meta')
   */
  @Get('perp-meta')
  async getPerpMarketMeta(@Query('testnet') testnet?: string) {
    const isTestnet = this.castTestnetFlag(testnet);
    return await this.cache.ensurePerpMeta(isTestnet);
  }

  /**
   * Renvoie les assets perp (universe) :
   * - markPrice
   * - oraclePrice
   * - funding
   * - open interest
   */
  @Get('perp-assets')
  async getPerpAssets(@Query('testnet') testnet?: string) {
    const isTestnet = this.castTestnetFlag(testnet);
    const meta = await this.cache.ensurePerpMeta(isTestnet);
    return this.infoService.getPerpAssets(meta, isTestnet);
  }

  /**
   * Combine les meta + asset ctxs pour construire une liste enrichie :
   * - name, decimals, leverage, marginTableId
   * - markPrice, oraclePrice, midPrice
   * - funding, openInterest
   *
   * (type: 'metaAndAssetCtxs')
   */
  @Get('perp-markets')
  async getPerpMarkets(@Query('testnet') testnet?: string) {
    const isTestnet = this.castTestnetFlag(testnet);
    return this.infoService.getPerpMarketsWithPrices(isTestnet);
  }

  // ---------------------------------------------------------------------------
  // 📌 SPOT — ROUTES D'INFORMATION
  // ---------------------------------------------------------------------------

  /**
   * Renvoie les soldes spot (quantités, coin, valeur, etc.)
   *
   * (type: 'spotClearinghouseState')
   */
  @Get('spot-balances')
  async getSpotBalances(@Query('testnet') testnet?: string) {
    const isTestnet = this.castTestnetFlag(testnet);
    return this.infoService.getSpotBalances(isTestnet);
  }

  /**
   * Renvoie la metadata spot :
   * - tokens ("index", "name", "szDecimals", etc.)
   * - universe ("tokens": [1, 0], etc.)
   *
   * (type: 'spotMeta')
   */
  @Get('spot-meta')
  async getSpotMarketMeta(@Query('testnet') testnet?: string) {
    const isTestnet = this.castTestnetFlag(testnet);
    return await this.cache.ensureSpotMeta(isTestnet);
  }

  /**
   * Renvoie les assets spot :
   * - prix oracle
   * - prix mid
   * - volume, etc.
   */
  @Get('spot-assets')
  async getSpotAssets(@Query('testnet') testnet?: string) {
    const isTestnet = this.castTestnetFlag(testnet);
    const meta = await this.cache.ensureSpotMeta(isTestnet);
    return this.infoService.getSpotAssets(meta, isTestnet);
  }
}
