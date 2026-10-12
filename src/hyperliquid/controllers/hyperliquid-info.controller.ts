import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Query,
  UseGuards,
} from '@nestjs/common';
import { HyperliquidApiPrivateInfoService } from '../services/hyperliquid-api-private-info.service';
import { HyperliquidApiPublicInfoService } from '../services/hyperliquid-api-public-info.service';
import { MarketMetaCacheService } from '../services/market-meta-cache.service';
import {
  GetActiveAssetDataQueryDto,
  GetCandlesQueryDto,
  GetFundingHistoryQueryDto,
  GetL2BookQueryDto,
} from '../dtos/hyperliquid-info.query.dto';
import { UserAuthGuard } from '../../common/guards/user-auth.guard';
import { AssetRegistryService } from '../services/asset-registry.service';
import { HlActiveAssetData, HlUserFees } from '@syldel/hl-shared-types';
import { HyperliquidCollateralService } from '../services/hyperliquid-collateral.service';

@Controller('hyperliquid/info')
export class HyperliquidInfoController {
  constructor(
    private readonly privateInfoService: HyperliquidApiPrivateInfoService,
    private readonly publicInfoService: HyperliquidApiPublicInfoService,
    private readonly cache: MarketMetaCacheService,
    private readonly assetRegistryService: AssetRegistryService,
    private readonly collateralService: HyperliquidCollateralService,
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
  @UseGuards(UserAuthGuard)
  async getPerpAccountState(
    @Query('dex') dex?: string,
    @Query('testnet') testnet?: string,
  ) {
    const isTestnet = this.castTestnetFlag(testnet);
    return this.privateInfoService.getPerpAccountState({ dex, isTestnet });
  }

  /**
   * Retrieve all perpetual DEXs from Hyperliquid.
   */
  @Get('perp-dexs')
  async getDexs(@Query('testnet') testnet?: string) {
    const isTestnet = testnet === 'true';
    return this.publicInfoService.getAllPerpDexs(isTestnet);
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
  async getPerpMarketMeta(
    @Query('dex') dex: string = '',
    @Query('testnet') testnet?: string,
  ) {
    const isTestnet = this.castTestnetFlag(testnet);
    return await this.cache.ensurePerpMeta(dex, isTestnet);
  }

  /**
   * Renvoie les assets perp (universe) :
   * - markPrice
   * - oraclePrice
   * - funding
   * - open interest
   *
   * (type: 'meta' with mapped universe)
   */
  @Get('perp-assets')
  async getPerpAssets(
    @Query('dex') dex: string = '',
    @Query('testnet') testnet?: string,
  ) {
    const isTestnet = this.castTestnetFlag(testnet);
    const meta = await this.cache.ensurePerpMeta(dex, isTestnet);
    return this.publicInfoService.getPerpAssets(meta, dex, isTestnet);
  }

  /**
   * Combine les meta + asset ctxs pour construire une liste enrichie :
   * - name, decimals, leverage, marginTableId
   * - markPrice, oraclePrice, midPrice
   * - funding, openInterest
   *
   * ⚠️ `midPrice` et `premium` valent **`null`** sur un marché délisté : c'est
   * ce que l'exchange rend, et le gateway le propage au lieu de l'écraser en
   * `undefined`. Les deux absences ne disent pas la même chose — `null` signale
   * que l'exchange n'a pas de prix milieu, `undefined` que la ligne de contexte
   * manquait en face de l'entrée d'univers. Relevé le 2026-10-01 : 75 contextes
   * sur 363, tous délistés. `markPrice`, lui, est toujours présent.
   *
   * Un consommateur doit donc écarter le `null` avant de calculer, pas le
   * convertir : `Number(null)` rend `0`, et `0` tranche là où `NaN` s'abstient.
   *
   * (type: 'metaAndAssetCtxs')
   */
  @Get('perp-markets')
  async getPerpMarkets(
    @Query('dex') dex: string = '',
    @Query('testnet') testnet?: string,
  ) {
    const isTestnet = this.castTestnetFlag(testnet);
    return this.publicInfoService.getPerpMarketsWithPrices(dex, isTestnet);
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
  @UseGuards(UserAuthGuard)
  async getSpotBalances(@Query('testnet') testnet?: string) {
    const isTestnet = this.castTestnetFlag(testnet);
    return this.privateInfoService.getSpotBalances(isTestnet);
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
   *
   * (type: 'spotMeta' with mapped universe)
   */
  @Get('spot-assets')
  async getSpotAssets(@Query('testnet') testnet?: string) {
    const isTestnet = this.castTestnetFlag(testnet);
    const meta = await this.cache.ensureSpotMeta(isTestnet);
    return this.publicInfoService.getSpotAssets(meta, isTestnet);
  }

  // ---------------------------------------------------------------------------
  // 📌 VARIOUS INFO ROUTES
  // ---------------------------------------------------------------------------

  /**
   * Récupère l'historique des bougies
   */
  @Get('candles')
  async getCandles(@Query() query: GetCandlesQueryDto) {
    return this.publicInfoService.getCandleSnapshot(query);
  }

  /**
   * Récupère l'historique de funding d'un marché : un point par heure.
   *
   * Sans mémoire : une requête reçue vaut un appel à Hyperliquid. La fraîcheur
   * appartient à l'appelant — voir `getFundingHistory` pour pourquoi, et pour
   * les trois significations de `"0.0"` qu'il ne faut surtout pas filtrer ici.
   */
  @Get('funding-history')
  async getFundingHistory(@Query() query: GetFundingHistoryQueryDto) {
    return this.publicInfoService.getFundingHistory(query);
  }

  /**
   * Récupère le snapshot du carnet d'ordres L2 (max 20 niveaux par côté)
   */
  @Get('l2-book')
  async getL2Book(@Query() query: GetL2BookQueryDto) {
    return this.publicInfoService.getL2BookSnapshot(query);
  }

  /**
   * Récupère l'historique du portfolio.
   */
  @Get('portfolio')
  @UseGuards(UserAuthGuard)
  async getPortfolio() {
    return this.privateInfoService.getUserPortfolio();
  }

  /**
   * Récupère le barème de frais de l'utilisateur authentifié.
   *
   * ⚠️ **Aucun code ne l'appelle, et elle attend un consommateur côté serveur.**
   * Écrite le 2026-10-12, conservée le lendemain sur décision explicite après
   * que le mobile a cessé d'en être le client. Deux précisions, pour qu'on ne
   * refasse pas le chemin à l'envers :
   *
   * - **le mobile ne passera pas par ici.** `userFees` est une information : il
   *   prend l'adresse en paramètre et ne signe rien, donc il tombe du côté de
   *   l'API publique, que l'app interroge déjà directement pour ses
   *   remplissages. Le faire transiter par ce garde rendait l'écran vide dans le
   *   mode normal de l'app, où l'adresse est mémorisée sans jeton valide ;
   * - **le backtest non plus.** `POST /analysis`, côté bot, est une route
   *   anonyme : il n'y aurait personne à qui attribuer un palier.
   *
   * Ce qu'elle attend, c'est un appelant **serveur** dans un contexte
   * utilisateur — le bot, qui passe par le gateway pour tout ce qui touche un
   * compte. Voir `nest-trading-bot/docs/known-gaps.md`, point 11.
   *
   * (type: 'userFees', poids 20)
   */
  @Get('user-fees')
  @UseGuards(UserAuthGuard)
  async getUserFees(@Query('testnet') testnet?: string): Promise<HlUserFees> {
    return this.privateInfoService.getUserFees(this.castTestnetFlag(testnet));
  }

  /**
   * Récupère les données de l'actif actif de l'utilisateur (levier, tailles max, capital disponible)
   */
  @Get('active-asset')
  @UseGuards(UserAuthGuard)
  async getActiveAssetData(
    @Query() query: GetActiveAssetDataQueryDto,
  ): Promise<HlActiveAssetData> {
    return this.privateInfoService.getActiveAssetData(query);
  }

  /**
   * Récupère l'ID numérique interne (Asset ID) d'un actif Hyperliquid à partir de son nom.
   * * @description
   * Cet endpoint interroge le registre local synchronisé pour convertir un nom de paire
   * (Perp standard, Builder DEX ou Spot) en son identifiant entier requis par les actions
   * d'échange (`order` et `cancel`).
   *
   * @param {string} name - Le nom unique du symbole ou de la paire (ex: "BTC", "PURR/USDC").
   * @returns {Promise<{ assetId: number }>} Un objet contenant l'ID numérique de l'actif.
   * * @throws {BadRequestException} Si le paramètre de requête `name` est manquant ou vide.
   * @throws {NotFoundException} Si le symbole n'est pas indexé dans le registre.
   * * @example
   * // Requête : GET /hyperliquid/info/asset-id?name=BTC
   * // Réponse : { "assetId": 0 }
   */
  @Get('asset-id')
  getAssetId(@Query('name') name: string): Promise<{ assetId: number }> {
    if (!name) {
      throw new BadRequestException('Query parameter "name" is required');
    }

    const assetId = this.assetRegistryService.getAssetId(name);
    if (assetId === undefined) {
      throw new NotFoundException(
        `Asset "${name}" not found. Ensure refreshSymbols() has been executed.`,
      );
    }

    return Promise.resolve({ assetId });
  }

  /**
   * Récupère le mode d'abstraction du compte (unifiedAccount, portfolioMargin, disabled, etc.)
   * Profite du cache de 24h géré par le service.
   */
  @Get('account-mode')
  @UseGuards(UserAuthGuard)
  async getAccountMode() {
    const mode = await this.collateralService.getAccountMode();
    return { mode };
  }

  /**
   * Récupère le solde du collatéral (total et utilisé) pour un actif donné.
   * Route automatiquement la requête selon le mode du compte (unifié ou cloisonné).
   * Résout le collatéral par défaut selon le DEX si non fourni.
   */
  @Get('collateral-balance')
  @UseGuards(UserAuthGuard)
  async getCollateralBalance(
    @Query('asset') asset: string,
    @Query('collateral') collateral?: string,
  ) {
    const balance = await this.collateralService.getCollateralBalance(
      asset,
      collateral,
    );
    return {
      asset,
      ...balance,
    };
  }
}
