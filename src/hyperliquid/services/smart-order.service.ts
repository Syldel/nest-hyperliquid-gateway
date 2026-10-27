import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';

import {
  BatchProtectiveOrders,
  DecimalString,
  ExistingProtectiveOrder,
  HLFrontendOpenOrder,
  HLModifyInput,
  HLOid,
  HLOrderDetails,
  HLOrderStatusData,
  HLOrderStatusResponse,
  HLPerpMarketExtended,
  HLPlaceOrderResponse,
  HLProtectiveKind,
  HLTif,
  InstantOrderParams,
  NormalizedProtectiveOrder,
  ProtectiveOrderParams,
  roundDecimal,
  SmartOrderResponse,
  WaitOrderStatusOptions,
} from '@syldel/hl-shared-types';
import { HyperliquidApiPrivateInfoService } from './hyperliquid-api-private-info.service';
import { HyperliquidApiPublicInfoService } from './hyperliquid-api-public-info.service';
import { HyperliquidApiTradeService } from './hyperliquid-api-trade.service';
import { DecimalUtilsService } from '../utils/decimal-utils.service';
import { PriceMathService } from './price-math.service';
import { AssetRegistryService } from './asset-registry.service';
import { ValueFormatterService } from './value-formatter.service';
import { HyperliquidGatewayException } from '../exceptions/hyperliquid-gateway.exception';
import { HyperliquidCollateralService } from './hyperliquid-collateral.service';
import { PositionLevelOrder } from '../utils/position-level-order';

/**
 * Un TP/SL « de position » ne porte ni taille ni choix de forme : de quoi dire où et dans quel sens. Voir
 * `docs/position-level-orders.md`.
 */
type PositionProtectiveParams = Pick<
  ProtectiveOrderParams,
  'assetName' | 'kind' | 'isBuy' | 'price'
>;

/**
 * Le prix limite `p` d'un ordre protecteur AU MARCHÉ : la borne que l'exchange recalculera lui-même.
 *
 * **Pour un déclencheur au marché, Hyperliquid ignore `p`** (mesuré le 2026-10-18 sur l'historique
 * du compte : 26 stops et take-profits au marché déclenchés, BTC et SOL, achats et ventes). Quel
 * que soit le `p` posé — le déclencheur lui-même, comme ce gateway le faisait avant, +8 %, ou
 * ses 90 % —, la ligne `filled` de l'ordre déclenché porte une borne de **déclencheur × 0,9 pour
 * une vente, × 1,1 pour un achat** : sa propre tolérance de glissement de 10 %, celle de sa doc.
 *
 * **L'arrondi, tel qu'il se lit sur ses ordres** : un achat est tronqué, une vente est tronquée
 * puis relevée d'un tick — y compris quand le produit tombe juste (78130 × 0,9 = 70317, il écrit
 * 70318 ; 79960 × 1,1 = 87956, il écrit 87956). Cela reproduit les 26 ordres de l'historique, les
 * deux produits exacts compris. ⚠️ Déduit de ces ordres, pas documenté ; la raison du tick de plus
 * pour une vente est inconnue, et les deux produits exacts sont des entiers BTC.
 *
 * Le champ reste obligatoire dans le format d'ordre. On y met donc ce que l'exchange recalculera,
 * pour que l'ordre au repos se lise comme l'ordre qui sera exécuté — et non plus `triggerPx`, qui
 * donnait à un stop au marché une limite qu'il n'a pas. Ce n'est **pas** une protection que
 * nous ajoutons : sans effet sur l'exécution au marché, et l'avant-2026-10-18 n'en souffrait pas.
 * Voir docs/protective-order-price.md.
 */
const MARKET_TRIGGER_LIMIT_FACTOR = { sell: '0.9', buy: '1.1' } as const;

@Injectable()
export class SmartOrderService {
  private readonly logger = new Logger(SmartOrderService.name);

  constructor(
    private readonly privateInfoService: HyperliquidApiPrivateInfoService,
    private readonly publicInfoService: HyperliquidApiPublicInfoService,
    private readonly tradeService: HyperliquidApiTradeService,
    private readonly decimalUtils: DecimalUtilsService,
    private readonly priceMath: PriceMathService,
    private readonly assetRegistry: AssetRegistryService,
    private readonly valueFormatter: ValueFormatterService,
    private readonly collateralService: HyperliquidCollateralService,
  ) {}

  private prepareOrderPrice(
    market: HLPerpMarketExtended,
    isBuy: boolean,
    tif: HLTif,
    params: { slippageTolerance?: number } = {},
  ): DecimalString {
    if (!market.markPrice) {
      throw new HyperliquidGatewayException(
        'INVALID_MARKET_DATA',
        `Missing mark price for asset ${market.name} during price preparation.`,
      );
    }

    const markPrice = market.markPrice;

    const { below, above } = this.priceMath.getOneTickAroundPrice(
      markPrice,
      market.szDecimals,
    );

    let price: DecimalString;

    if (tif === 'Alo') {
      // MODE PASSIF : On s'écarte du marché pour s'assurer d'être Maker
      price = isBuy ? below : above;
    } else if (tif === 'Ioc') {
      // MODE AGRESSIF (Protection Slippage) : On accepte de payer un peu plus cher
      // pour mordre dans le carnet (Taker) tout en fixant une limite stricte.
      const slippagePercent = params.slippageTolerance ?? 0.002;
      const markNum = Number(market.markPrice);

      // Si Buy : on est prêt à payer jusqu'à +0.2% au-dessus du markPrice
      // Si Sell : on accepte de vendre jusqu'à -0.2% en dessous du markPrice
      const rawLimitPrice = isBuy
        ? markNum * (1 + slippagePercent)
        : markNum * (1 - slippagePercent);

      const isPerp = this.assetRegistry.isPerp(market.name);

      // Règle (6 - szDecimals) et des 5 chiffres significatifs
      price = this.valueFormatter.formatPrice(
        rawLimitPrice,
        market.szDecimals,
        isPerp ? 'perp' : 'spot',
      );
    } else {
      price = market.markPrice;
    }

    return price;
  }

  async instantOrder(params: InstantOrderParams): Promise<HLOrderStatusData> {
    const {
      assetName,
      isBuy,
      size,
      tif = 'Alo',
      reduceOnly = false,
      isTestnet = false,
      maxRetries = 6,
      delayMs = 7500,
    } = params;

    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;

      const dex = this.assetRegistry.getDexForAsset(assetName);
      const assets = await this.publicInfoService.getPerpMarketsWithPrices(
        dex,
        isTestnet,
      );
      const market = assets.find((a) => a.name === assetName);
      if (!market || !market.markPrice) {
        throw new HyperliquidGatewayException(
          'INVALID_MARKET_DATA',
          `Invalid market data or mark price for ${assetName}`,
        );
      }

      const price = this.prepareOrderPrice(market, isBuy, tif);

      let sz: DecimalString;
      if (size.type === 'base') {
        sz = size.sz;
      } else if (size.type === 'quote') {
        sz = this.usdcToSize(size.usdc, price, market.szDecimals);
      } else {
        const quoteValue = await this.resolveQuoteFromPercent({
          percent: size.percent,
          asset: assetName,
          isTestnet,
        });
        sz = this.usdcToSize(quoteValue, price, market.szDecimals);
      }

      // TODO: Check if the minimum value is the same for all assets on Hyperliquid Perps
      if (
        this.decimalUtils.lte(
          this.decimalUtils.multiply(sz, price, market.szDecimals),
          '10',
        )
      ) {
        throw new ConflictException({
          error: 'ORDER_MIN_VALUE',
          message: `Order must have minimum value of $10.`,
        });
      }

      const oParams: HLOrderDetails = {
        assetName,
        isBuy,
        sz,
        limitPx: price.toString(),
        reduceOnly,
        orderType: {
          limit: { tif },
        },
      };
      this.logger.log(`Place order: ${JSON.stringify(oParams)}`);
      const order = await this.tradeService.placeOrder({
        order: oParams,
        isTestnet,
      });

      const decision = this.shouldRetryOrder(order.response);
      if (decision.error) {
        throw new ConflictException({
          error: decision.error.code,
          message: decision.error.message,
        });
      } else if (!decision.retry) {
        // ordre accepté
        const poStatus = order.response.data.statuses[0];
        const oid = poStatus.resting?.oid || poStatus.filled?.oid;
        if (!oid) {
          throw new HyperliquidGatewayException(
            'EXCHANGE_MALFORMED_RESPONSE',
            'Instant order executed but OID (Order ID) is undefined in exchange response',
            HttpStatus.BAD_GATEWAY,
          );
        }

        const { finalStatus, raw, timedOut } =
          await this.waitForOrderFinalStatus(this.privateInfoService, {
            oid,
            isTestnet,
          });

        if (timedOut && finalStatus === 'open') {
          const assetId = this.assetRegistry.getAssetId(assetName);
          if (assetId === undefined) {
            throw new HyperliquidGatewayException(
              'REGISTRY_ASSET_NOT_FOUND',
              `Cannot cancel order: asset ${assetName} was not found in the asset registry.`,
              HttpStatus.INTERNAL_SERVER_ERROR,
            );
          }

          // ordre toujours ouvert → on cancel
          const cancelResult = await this.tradeService.cancelOrder(
            [{ asset: assetId, oid }],
            isTestnet,
          );

          const cancelStatuses = cancelResult?.response?.data?.statuses ?? [];
          const hasCancelSuccess = cancelStatuses.some((s) => s === 'success');
          const cancelErrors = cancelStatuses
            .filter((s) => typeof s === 'object' && 'error' in s)
            .map((s) => s.error);

          if (hasCancelSuccess) {
            this.logger.log(`Order ${oid} canceled due to timeout`);
          }
          if (cancelErrors.length > 0) {
            this.logger.warn(
              `Order ${oid} cancel returned errors: ${cancelErrors.join(' | ')}`,
            );
          }

          const lastStatus = await this.privateInfoService
            .getOrderStatus(oid, isTestnet)
            .catch(() => null);

          if (!lastStatus?.order) {
            this.logger.error(
              `[CRITICAL] Order ${oid} state is UNKNOWN. Cancel did not return success and fetch failed.`,
            );
            throw new HyperliquidGatewayException(
              'UNKNOWN_ORDER_STATE',
              `CRITICAL: Order ${oid} timed out, cancel status unclear, and final fetch failed. Halting bot to prevent ghost positions.`,
              HttpStatus.INTERNAL_SERVER_ERROR,
            );
          }

          return lastStatus.order;
        } else if (finalStatus === 'filled' || finalStatus === 'triggered') {
          // this.logger.log(`Order ${oid} executed successfully`);
        } else {
          this.logger.log(`Order ${oid} failed with status ${finalStatus}`);
        }

        return raw;
      }

      await this.sleep(delayMs);
    }

    throw new ConflictException({
      error: 'INSTANT_ORDER_FAILED',
      message: 'Instant order failed after max retries',
    });
  }

  private usdcToSize(
    quoteUsdc: DecimalString,
    price: DecimalString,
    szDecimals: number,
  ): string {
    return this.decimalUtils.divide(quoteUsdc, price, szDecimals, 'quote size');
  }

  async resolveQuoteFromPercent(params: {
    percent: DecimalString;
    asset: string;
    isTestnet?: boolean;
  }): Promise<DecimalString> {
    const { percent, asset } = params;

    const pctValue = this.decimalUtils.parse(percent);
    if (pctValue <= 0 || pctValue > 1) {
      throw new BadRequestException({
        error: 'INVALID_ORDER_PARAMS',
        message: `percent must be between 0 and 1, got ${percent}`,
      });
    }

    const balanceInfo =
      await this.collateralService.getCollateralBalance(asset);

    // Ne pas savoir dans quoi un marché se règle n'est pas un manque de fonds :
    // approvisionner le compte n'y changerait rien. Les deux cas portaient le
    // même message tant que le collatéral introuvable rendait `'0'`.
    if (balanceInfo.status === 'unknown-collateral') {
      throw new HyperliquidGatewayException(
        'UNKNOWN_COLLATERAL',
        `Cannot determine which asset "${asset}" settles in`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // Un mode non modélisé n'est pas non plus un manque de fonds : le capital
    // existe peut-être, c'est ce gateway qui ne sait pas le lire. Dimensionner
    // un ordre dessus reviendrait à inventer le nombre qu'on vient de refuser.
    if (balanceInfo.status === 'unsupported-mode') {
      throw new HyperliquidGatewayException(
        'UNSUPPORTED_ACCOUNT_MODE',
        `Cannot read collateral while the account is in ${balanceInfo.mode} mode`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // À partir d'ici il ne reste que `ok` et `no-balance-entry`, et les deux
    // portent un `collateral` : c'est ce qui permet de le nommer dans le
    // message d'erreur plutôt que d'y écrire « USDC » en dur.
    const accountValue =
      balanceInfo.status === 'ok' ? balanceInfo.total : undefined;

    if (
      accountValue === undefined ||
      !this.decimalUtils.isPositive(accountValue)
    ) {
      throw new HyperliquidGatewayException(
        'INSUFFICIENT_COLLATERAL',
        `No ${balanceInfo.collateral} collateral available on Hyperliquid account`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const usdcToUse = this.decimalUtils.multiply(
      accountValue,
      percent,
      6,
      `${balanceInfo.collateral} balance`,
    );

    if (!this.decimalUtils.isPositive(usdcToUse)) {
      throw new HyperliquidGatewayException(
        'COMPUTED_AMOUNT_ZERO',
        'Computed USDC amount for the order size is zero or negative',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    return this.decimalUtils.format(this.decimalUtils.parse(usdcToUse), 6);
  }

  private mapOrderErrorToCode(errorMsg?: string): string {
    const msg = (errorMsg || '').toLowerCase();

    if (msg.includes('minimum value')) return 'ORDER_MIN_VALUE';
    if (msg.includes('insufficient margin')) return 'INSUFFICIENT_MARGIN';

    if (msg.includes('post only') || msg.includes('post-only')) {
      return 'POST_ONLY_REJECTED';
    }
    if (msg.includes('ioc') || msg.includes('could not immediately match')) {
      return 'IOC_REJECTED';
    }
    if (msg.includes('trigger')) return 'BAD_TRIGGER_PRICE';

    return 'INSTANT_ORDER_FAILED';
  }

  private shouldRetryOrder(response: HLPlaceOrderResponse): {
    retry: boolean;
    error?: { code: string; message: string };
  } {
    const statuses = response.data.statuses;

    if (!statuses || statuses.length === 0) {
      // Cas improbable, mais on retry
      return { retry: true };
    }

    for (const s of statuses) {
      this.logger.log(`Open order status: ${JSON.stringify(s)}`);
      if ('error' in s) {
        const code = this.mapOrderErrorToCode(s.error);
        const retryable = ['POST_ONLY_REJECTED', 'IOC_REJECTED'].includes(code);
        return retryable
          ? { retry: true }
          : {
              retry: false,
              error: { code, message: s.error || 'Unknown error' },
            };
      }

      if ('resting' in s || 'filled' in s) {
        return { retry: false }; // ordre bien passé
      }
    }

    // Aucun status clair → retry
    return { retry: true };
  }

  async waitForOrderFinalStatus(
    infoService: {
      getOrderStatus: (
        oid: HLOid,
        isTestnet?: boolean,
      ) => Promise<HLOrderStatusResponse>;
    },
    options: WaitOrderStatusOptions,
  ): Promise<{
    finalStatus: string;
    raw: HLOrderStatusData;
    timedOut: boolean;
    partialFilled: boolean;
    filledQuantity: number;
    remainingQuantity: number;
  }> {
    const {
      oid,
      isTestnet,
      timeoutMs = 45_000,
      pollIntervalMs = 7_500,
    } = options;

    const start = Date.now();

    const parseOrder = (order: HLOrderStatusData) => {
      const o = order;
      const status = o?.status ?? 'unknownOid';
      const orig = Number(o?.order?.origSz || 0);
      const rem = Number(o?.order?.sz || 0);
      const filled = orig - rem;
      const partialFilled = filled > 0 && rem > 0;
      return { o, status, orig, rem, filled, partialFilled };
    };

    while (Date.now() - start < timeoutMs) {
      const status = await infoService.getOrderStatus(oid, isTestnet);
      if (!status || status.status === 'unknownOid') {
        await this.sleep(pollIntervalMs);
        continue;
      }

      const {
        o,
        status: s,
        filled,
        rem,
        orig,
        partialFilled,
      } = parseOrder(status.order);

      this.logger.log(
        `Order ${oid} status: ${s} (filled: ${filled} / ${orig})`,
      );

      if (s === 'filled' || s === 'triggered') {
        return {
          finalStatus: s,
          raw: o,
          timedOut: false,
          partialFilled: false,
          filledQuantity: orig,
          remainingQuantity: 0,
        };
      }

      if (
        s.endsWith('Canceled') ||
        s.endsWith('Rejected') ||
        s === 'canceled' ||
        s === 'rejected'
      ) {
        return {
          finalStatus: s,
          raw: o,
          timedOut: false,
          partialFilled,
          filledQuantity: filled,
          remainingQuantity: rem,
        };
      }

      // open = toujours en book
      await this.sleep(pollIntervalMs);
    }

    const lastStatus = await infoService.getOrderStatus(oid, isTestnet);
    const {
      o,
      status: s,
      filled,
      rem,
      partialFilled,
    } = parseOrder(lastStatus?.order);

    return {
      finalStatus: s,
      raw: o,
      timedOut: true,
      partialFilled,
      filledQuantity: filled,
      remainingQuantity: rem,
    };
  }

  sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* ************************************************************* */

  async placeProtectiveOrder(params: HLOrderDetails, isTestnet = false) {
    this.logger.log(`Place protective order: ${JSON.stringify(params)}`);

    const response = await this.tradeService.placeOrder({
      order: params,
      isTestnet,
    });

    const statuses = response.response.data.statuses;
    if (!statuses || statuses.length === 0) {
      throw new HyperliquidGatewayException(
        'EXCHANGE_EMPTY_RESPONSE',
        'No order status returned from Hyperliquid API',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const status = statuses[0];

    if ('error' in status) {
      const code = this.mapOrderErrorToCode(status.error);
      throw new HyperliquidGatewayException(
        `EXCHANGE_ERROR_${code.toUpperCase()}`,
        `Hyperliquid execution error: ${status.error}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    // ordre placé avec succès (resting ou filled)
    return response;
  }

  /* ************************************************************* */

  /**
   * Un TP/SL « de position » : sans taille, un déclencheur AU MARCHÉ, reduce-only, dans le groupe `positionTpsl` (voir
   * `utils/position-level-order.ts` et `docs/position-level-orders.md`). Il n'a de commun avec `placeProtectiveOrder`
   * que la lecture du statut : cette famille n'a pas de `sz` à formater, donc pas de zéro à tolérer.
   *
   * `params.isBuy` est le côté de l'ORDRE, donc de la clôture, comme pour `toHLOrderDetails`.
   */
  async placePositionProtectiveOrder(
    params: PositionProtectiveParams,
    isTestnet = false,
  ) {
    this.logger.log(
      `Place position-level ${params.kind}: ${JSON.stringify(params)}`,
    );

    const response = await this.tradeService.placePositionLevelOrder({
      order: this.toPositionLevelOrder(params),
      isTestnet,
    });

    return this.requireAcceptedOrder(response);
  }

  /** Modifie un ordre de position existant. ⚠️ Ce que l'exchange en fait n'est pas mesuré. */
  async modifyPositionProtectiveOrder(
    oid: HLOid,
    params: PositionProtectiveParams,
    isTestnet = false,
  ) {
    this.logger.log(
      `Modify position-level ${params.kind} ${oid}: ${JSON.stringify(params)}`,
    );

    const response = await this.tradeService.modifyPositionLevelOrder(
      oid,
      this.toPositionLevelOrder(params),
      isTestnet,
    );

    return this.requireAcceptedOrder(response);
  }

  private toPositionLevelOrder(
    params: PositionProtectiveParams,
  ): PositionLevelOrder {
    return {
      assetName: params.assetName,
      isBuy: params.isBuy,
      limitPx: this.marketTriggerLimitPx(params),
      triggerPx: params.price,
      tpsl: params.kind,
    };
  }

  /** Le statut d'un ordre accepté, ou une erreur : la même lecture que `placeProtectiveOrder`. */
  private requireAcceptedOrder(
    response: Awaited<
      ReturnType<HyperliquidApiTradeService['placePositionLevelOrder']>
    >,
  ) {
    const statuses = response.response.data.statuses;
    if (!statuses || statuses.length === 0) {
      throw new HyperliquidGatewayException(
        'EXCHANGE_EMPTY_RESPONSE',
        'No order status returned from Hyperliquid API',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const status = statuses[0];

    if ('error' in status) {
      const code = this.mapOrderErrorToCode(status.error);
      throw new HyperliquidGatewayException(
        `EXCHANGE_ERROR_${code.toUpperCase()}`,
        `Hyperliquid execution error: ${status.error}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    return response;
  }

  /**
   * Transforme les paramètres d'un ProtectiveOrder en HLOrderDetails
   * pour Hyperliquid.
   *
   * Cette méthode est utilisée pour créer un ordre **protective** (Take Profit ou Stop Loss)
   * à partir des paramètres fournis, avec `reduceOnly` forcé à true.
   *
   * `params.isBuy` est le côté de l'ORDRE, donc de la clôture : un stop qui ferme un long est
   * une vente (`isBuy: false`). C'est ce que le bot envoie, et c'est de lui que dépend le sens
   * du prix limite.
   *
   * Au marché (le défaut), `p` est la borne que l'exchange recalcule et applique : voir
   * `MARKET_TRIGGER_LIMIT_FACTOR` — il ignore celui qu'on lui envoie. Un déclencheur **limite**
   * (`isMarket: false`) garde `p = triggerPx` : l'appelant ne donne qu'un prix, et en choisir un
   * autre à sa place serait décider d'un ordre qu'il a voulu précis — le gateway est une
   * passerelle, il ne refuse pas ce que l'exchange accepte. ⚠️ Ici `p` est le prix de l'ordre posé
   * au déclenchement, donc un vrai plancher, et un limite égal au déclencheur est **le cas mesuré
   * qui reste au carnet** : un Stop Limit ETH est resté 826 secondes sans s'exécuter, la
   * position ouverte et sans protection (2026-10-18). Ce cas est donc **signalé**, en
   * avertissement de journal à chaque construction ; aucun appelant connu ne l'utilise.
   */
  public toHLOrderDetails(params: ProtectiveOrderParams): HLOrderDetails {
    const isMarket = params.isMarket ?? true;

    if (!isMarket) {
      this.logger.warn(
        `[${params.assetName}] ${params.kind.toUpperCase()} as a LIMIT trigger (isMarket: false): ` +
          `p = triggerPx = ${params.price}, a limit equal to the trigger. Measured on 2026-10-18: ` +
          `such a stop can trigger and then rest on the book unfilled (826 s on an ETH Stop Limit), ` +
          `the position open and unprotected. See docs/protective-order-price.md.`,
      );
    }

    return {
      assetName: params.assetName,
      isBuy: params.isBuy,
      sz: params.sz,
      limitPx: isMarket ? this.marketTriggerLimitPx(params) : params.price,
      reduceOnly: true, // forcé pour SL / TP
      orderType: {
        trigger: {
          isMarket,
          triggerPx: params.price,
          tpsl: params.kind,
        },
      },
    };
  }

  /**
   * La borne de l'exchange pour un déclencheur au marché : le déclencheur écarté de 10 %, arrondi
   * comme lui (voir `MARKET_TRIGGER_LIMIT_FACTOR`) à la grille de prix. Un actif inconnu
   * **échoue** : se rabattre sur des décimales par défaut ferait poser un prix que l'exchange
   * refuse ou tronque, sur un ordre dont la seule fonction est de protéger.
   */
  private marketTriggerLimitPx(
    params: Pick<ProtectiveOrderParams, 'assetName' | 'isBuy' | 'price'>,
  ): string {
    const szDecimals = this.requireSzDecimals(params.assetName);

    const factor = params.isBuy
      ? MARKET_TRIGGER_LIMIT_FACTOR.buy
      : MARKET_TRIGGER_LIMIT_FACTOR.sell;
    // Arithmétique exacte : un flottant peut placer le dernier chiffre un tick de travers.
    const bound = this.decimalUtils.multiply(params.price, factor, 8, 'price');

    const marketType = this.assetRegistry.isPerp(params.assetName)
      ? 'perp'
      : 'spot';
    const decimals = this.valueFormatter.priceDecimals(
      bound,
      szDecimals,
      marketType,
    );

    // Tronqué ; une vente est ensuite relevée d'un tick.
    const truncated = roundDecimal(bound, decimals, 'truncate');
    const rounded = params.isBuy
      ? truncated
      : this.addOneTick(truncated, decimals);

    return this.valueFormatter.formatPrice(rounded, szDecimals, marketType);
  }

  /**
   * La grille de taille d'un actif, ou une **erreur**. Jamais un défaut : formater sur 6 décimales un actif
   * dont la grille est 2 pose un prix ou une taille que l'exchange refuse ou que le gateway tronque
   * autrement que le demandeur ne le croit. Deux endroits la remplaçaient en silence par 6
   * (`normalizeModifyInput`, `canonicalOrRaw`) alors que `marketTriggerLimitPx` refusait déjà.
   */
  private requireSzDecimals(assetName: string): number {
    const szDecimals = this.assetRegistry.getSzDecimals(assetName);
    if (szDecimals === undefined) {
      throw new HyperliquidGatewayException(
        'UNKNOWN_ASSET',
        `Unknown szDecimals for: ${assetName}`,
      );
    }
    return szDecimals;
  }

  /** Un tick de plus : une unité du dernier chiffre permis, `decimals` décimales. */
  private addOneTick(value: string, decimals: number): string {
    const [int, frac = ''] = value.split('.');
    const units = BigInt(int + frac.padEnd(decimals, '0')) + 1n;
    const digits = units.toString().padStart(decimals + 1, '0');
    const whole = digits.slice(0, digits.length - decimals);
    const fraction = decimals > 0 ? digits.slice(digits.length - decimals) : '';

    return fraction ? `${whole}.${fraction}` : whole;
  }

  private sortProtectiveOrders<T extends { price: string }>(
    orders: readonly T[],
    kind: HLProtectiveKind,
    isBuy: boolean,
  ): T[] {
    return [...orders].sort((a, b) => {
      const pa = Number(a.price);
      const pb = Number(b.price);

      if (kind === 'tp') {
        return isBuy ? pa - pb : pb - pa;
      }

      return isBuy ? pb - pa : pa - pb;
    });
  }

  private diffProtectiveOrders(
    assetName: string,
    isBuy: boolean,
    kind: HLProtectiveKind,
    existing: ExistingProtectiveOrder[],
    desired: NormalizedProtectiveOrder[],
  ) {
    const modifies: HLModifyInput[] = [];
    const cancels: HLOid[] = [];
    const creates: NormalizedProtectiveOrder[] = [];

    const sortedExisting = this.sortProtectiveOrders(existing, kind, isBuy);
    const sortedDesired = this.sortProtectiveOrders(desired, kind, isBuy);

    const updateCount = Math.min(sortedExisting.length, sortedDesired.length);

    // 1️⃣ UPDATE → les plus proches
    for (let i = 0; i < updateCount; i++) {
      const cur = sortedExisting[i];
      const next = sortedDesired[i];

      modifies.push({
        oid: cur.oid,
        order: this.toHLOrderDetails({
          assetName,
          isBuy,
          sz: next.sz,
          price: next.price,
          isMarket: next.isMarket,
          kind,
        }),
      });
    }

    // 2️⃣ CANCEL → existants trop éloignés
    for (let i = updateCount; i < sortedExisting.length; i++) {
      cancels.push(sortedExisting[i].oid);
    }

    // 3️⃣ CREATE → souhaités manquants (les plus éloignés)
    for (let i = updateCount; i < sortedDesired.length; i++) {
      creates.push(sortedDesired[i]);
    }

    return { modifies, cancels, creates };
  }

  private normalizeModifyInput(
    m: HLModifyInput,
  ): NormalizedProtectiveOrder | null {
    const ot = m.order.orderType;

    const isTrigger = 'trigger' in ot;
    if (!isTrigger) {
      return null;
    }

    const szDecimals = this.requireSzDecimals(m.order.assetName);
    const isPerp = this.assetRegistry.isPerp(m.order.assetName);

    return {
      kind: ot.trigger.tpsl,
      price: this.valueFormatter.formatPrice(
        ot.trigger.triggerPx,
        szDecimals,
        isPerp ? 'perp' : 'spot',
      ),
      sz: this.valueFormatter.formatSize(m.order.sz, szDecimals),
      isMarket: ot.trigger.isMarket,
    };
  }

  /**
   * Réécrit une valeur rendue par Hyperliquid dans la forme canonique que la
   * demande prendra, pour que les deux se comparent sur la **valeur** et non
   * sur l'écriture.
   *
   * Un ordre qu'Hyperliquid détient est valide par construction, donc ce
   * formatage est un point fixe : il ne peut rien perdre. S'il échoue malgré
   * tout, c'est que nos règles divergent des siennes — on garde alors la valeur
   * brute, ce qui fait simplement conclure « changé » et renvoyer une
   * modification, et on le dit plutôt que de le taire.
   */
  private canonicalOrRaw(
    value: string,
    assetName: string,
    field: 'price' | 'size',
  ): string {
    const szDecimals = this.assetRegistry.getSzDecimals(assetName);
    if (szDecimals === undefined) {
      // Pas de grille devinée : formater sur 6 décimales aurait écrit l'ordre de l'exchange autrement qu'il
      // ne l'est, donc jugé « changé » à chaque appel et modifié à chaque passage. Comparé tel quel, et dit.
      this.logger.warn(
        `[${assetName}] szDecimals unknown to the registry: existing protective ${field} ${value} is compared raw.`,
      );
      return value;
    }
    const isPerp = this.assetRegistry.isPerp(assetName);

    try {
      return field === 'price'
        ? this.valueFormatter.formatPrice(
            value,
            szDecimals,
            isPerp ? 'perp' : 'spot',
          )
        : this.valueFormatter.formatSize(value, szDecimals);
    } catch (error) {
      this.logger.warn(
        `[${assetName}] Existing protective ${field} ${value} does not survive our own formatting ` +
          `(szDecimals ${szDecimals}): ${(error as Error).message}. Comparing it raw.`,
      );

      return value;
    }
  }

  /**
   * Compare deux protections déjà réécrites dans la même forme canonique — voir
   * `canonicalOrRaw`. Avant le 2026-09-23, la demande passait par `formatPrice`
   * (« 1103 ») quand l'existant gardait l'écriture d'Hyperliquid (« 1103.0 ») :
   * un prix entier était jugé changé, et l'ordre modifié à chaque appel avec un
   * nouvel oid. Constaté le 2026-09-22 sur un take-profit à 1 103 lors du test
   * en conditions réelles du bot ; un stop à 1 068,1, écrit pareil des deux
   * côtés, était laissé tel quel.
   */
  private isSameProtectiveOrder(
    a: NormalizedProtectiveOrder,
    b: NormalizedProtectiveOrder,
  ): boolean {
    return (
      a.kind === b.kind &&
      a.price === b.price &&
      a.sz === b.sz &&
      Boolean(a.isMarket) === Boolean(b.isMarket)
    );
  }

  private filterUnchangedOrders(params: {
    modList: HLModifyInput[];
    existing: ExistingProtectiveOrder[];
    assetName: string;
  }): HLModifyInput[] {
    const { modList, existing } = params;

    return modList.filter((m) => {
      const normalized = this.normalizeModifyInput(m);

      // Pas un TP/SL → on conserve
      if (!normalized) {
        return true;
      }

      const exists = existing.some((e) =>
        this.isSameProtectiveOrder(normalized, e),
      );

      if (exists) {
        this.logger.log(
          `[Skip Update] ${m.order.assetName} ${m.oid} ${normalized.kind.toUpperCase()} ` +
            `price=${normalized.price} size=${normalized.sz} market=${normalized.isMarket}`,
        );
      }

      return !exists;
    });
  }

  /**
   * Place / update / cancel TP & SL orders so that on-chain state
   * matches the desired BatchProtectiveOrders input.
   */
  async placeBatchProtectiveOrders(
    params: BatchProtectiveOrders,
    isTestnet = false,
  ) {
    const { assetName, isBuy } = params;

    const assetId = this.assetRegistry.getAssetId(assetName);
    if (assetId === undefined) {
      throw new HyperliquidGatewayException(
        'UNKNOWN_ASSET',
        `Unknown asset: ${assetName}`,
      );
    }

    // injecte le kind pour TP et SL
    const pTPs: NormalizedProtectiveOrder[] = (params.tp ?? []).map((item) => ({
      ...item,
      kind: 'tp' as const,
    }));

    const pSLs: NormalizedProtectiveOrder[] = (params.sl ?? []).map((item) => ({
      ...item,
      kind: 'sl' as const,
    }));

    const result: SmartOrderResponse = {
      tp: { cancelled: [], created: [], updated: [] },
      sl: { cancelled: [], created: [], updated: [] },
    };

    const dex = this.assetRegistry.getDexForAsset(assetName);

    // 1️⃣ Fetch existing protective orders
    const openOrders = await this.privateInfoService.getFrontendOpenOrders(
      dex,
      isTestnet,
    );

    function mapKind(orderType?: string): HLProtectiveKind {
      const type = orderType?.toLowerCase() || '';
      if (type.includes('take profit')) return 'tp';
      if (type.includes('stop')) return 'sl';
      return 'sl';
    }

    const existing: ExistingProtectiveOrder[] = openOrders
      .filter((o) => o.coin === assetName)
      .filter((o) => o.reduceOnly && o.isTrigger)
      .map((o) => ({
        oid: o.oid,
        kind: mapKind(o.orderType),
        // Écrit comme la demande le sera. Hyperliquid rend un prix entier avec
        // une décimale (« 1103.0 ») quand `formatPrice` rend « 1103 » : les
        // comparer tels quels jugeait changé un ordre identique, et le modifiait
        // à chaque passage avec un nouvel oid. Mesuré le 2026-09-22.
        price: this.canonicalOrRaw(o.triggerPx, assetName, 'price'),
        sz: this.canonicalOrRaw(o.sz, assetName, 'size'),
        isMarket: o.orderType.toLowerCase().includes('market'),
      }))
      .sort((a, b) => Number(a.price) - Number(b.price));

    let openOrder: HLFrontendOpenOrder | undefined;
    existing.forEach((o) => {
      openOrder = openOrders.find((r) => r.oid === o.oid);
      this.logger.log(
        `Existing open order [${assetName}]: ${o.oid} [${o.kind}] ${openOrder ? (openOrder.side === 'B' ? 'BUY' : 'SELL') : '?'} ${o.sz} @ ${o.price}`,
      );
    });

    const existingTp = existing.filter((o) => o.kind === 'tp');
    const existingSl = existing.filter((o) => o.kind === 'sl');

    // 2️⃣ Desired state
    const desiredTp = pTPs ?? [];
    const desiredSl = pSLs ?? [];

    // 3️⃣ Diff
    const tpDiff = this.diffProtectiveOrders(
      assetName,
      isBuy,
      'tp',
      existingTp,
      desiredTp,
    );

    const slDiff = this.diffProtectiveOrders(
      assetName,
      isBuy,
      'sl',
      existingSl,
      desiredSl,
    );

    const realTPModifies = this.filterUnchangedOrders({
      modList: tpDiff.modifies,
      existing,
      assetName,
    });
    const realSLModifies = this.filterUnchangedOrders({
      modList: slDiff.modifies,
      existing,
      assetName,
    });

    // 4️⃣ batchModify (priority)
    const modifies = [...realTPModifies, ...realSLModifies];

    const ignoredCount =
      tpDiff.modifies.length + slDiff.modifies.length - modifies.length;
    if (ignoredCount > 0) {
      this.logger.debug(
        `${ignoredCount} protective orders unchanged, skipping modify.`,
      );
    }

    if (modifies.length > 0) {
      const bathModifyRes = await this.tradeService.batchModifyOrders(
        modifies,
        isTestnet,
      );

      if (bathModifyRes.status === 'ok') {
        const bmStatus = bathModifyRes.response.data.statuses;

        modifies.forEach((m, index) => {
          const status = bmStatus[index];
          if (!status) return;

          const newOid = status.resting?.oid || status.filled?.oid;
          if (newOid) {
            const isTp = tpDiff.modifies.some((tpM) => tpM.oid === m.oid);
            if (isTp) {
              result.tp.updated.push(newOid);
            } else {
              result.sl.updated.push(newOid);
            }
          } else if (status.error) {
            this.logger.error(
              `Failed to modify order ${m.oid}: ${status.error}`,
            );

            // Fallback: Try to cancel the existing order and recreate it
            const isTp = tpDiff.modifies.some((tpM) => tpM.oid === m.oid);
            const currentOrder = m;

            if (isTp) {
              // --- Gestion du Take Profit (TP) ---
              tpDiff.cancels.push(currentOrder.oid);

              const normalizedTp = this.normalizeModifyInput(currentOrder);
              if (normalizedTp !== null) {
                tpDiff.creates.push(normalizedTp);
              } else {
                this.logger.warn(
                  `Failed to normalize TP order for fallback creation (OID: ${currentOrder.oid})`,
                );
              }
            } else {
              // --- Gestion du Stop Loss (SL) ---
              slDiff.cancels.push(currentOrder.oid);

              const normalizedSl = this.normalizeModifyInput(currentOrder);
              if (normalizedSl !== null) {
                slDiff.creates.push(normalizedSl);
              } else {
                this.logger.warn(
                  `Failed to normalize SL order for fallback creation (OID: ${currentOrder.oid})`,
                );
              }
            }
          }
        });
      }
    }

    // 5️⃣ Cancels
    const cancels = [...tpDiff.cancels, ...slDiff.cancels];

    if (cancels.length > 0) {
      const cancelRes = await this.tradeService.cancelOrder(
        cancels.map((oid) => ({
          asset: assetId,
          oid,
        })),
        isTestnet,
      );

      if (cancelRes.status === 'ok') {
        const statuses = cancelRes.response.data.statuses;
        cancels.forEach((oid, index) => {
          const status = statuses[index];
          if (status === 'success') {
            if (tpDiff.cancels.includes(oid)) {
              result.tp.cancelled.push(oid);
            } else {
              result.sl.cancelled.push(oid);
            }
          } else {
            this.logger.warn(
              `Failed to cancel order ${oid}: ${JSON.stringify(status)}`,
            );
          }
        });
      } else {
        const statusMsg = cancelRes ? String(cancelRes.status) : 'No response';
        this.logger.error(`Cancel batch request failed: ${statusMsg}`);
      }
    }

    // 6️⃣ Creates
    for (const tp of tpDiff.creates) {
      const res = await this.tradeService.placeOrder({
        order: this.toHLOrderDetails({
          assetName,
          isBuy,
          sz: tp.sz,
          price: tp.price,
          isMarket: tp.isMarket,
          kind: 'tp',
        }),
        isTestnet,
      });
      const oStatus = res.response.data.statuses[0];
      const oid = oStatus?.resting?.oid || oStatus?.filled?.oid;
      if (oid) {
        result.tp.created.push(oid);
      } else {
        this.logger.error(`Order creation failed: ${JSON.stringify(oStatus)}`);
      }
    }

    for (const sl of slDiff.creates) {
      const res = await this.tradeService.placeOrder({
        order: this.toHLOrderDetails({
          assetName,
          isBuy,
          sz: sl.sz,
          price: sl.price,
          isMarket: sl.isMarket,
          kind: 'sl',
        }),
        isTestnet,
      });
      const oStatus = res.response.data.statuses[0];
      const oid = oStatus?.resting?.oid || oStatus?.filled?.oid;
      if (oid) {
        result.sl.created.push(oid);
      } else {
        this.logger.error(`Order creation failed: ${JSON.stringify(oStatus)}`);
      }
    }

    return result;
  }
}
