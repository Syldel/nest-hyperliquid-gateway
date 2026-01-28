import {
  BadRequestException,
  ConflictException,
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
  HLPlaceOrderResponse,
  HLProtectiveKind,
  InstantOrderParams,
  NormalizedProtectiveOrder,
  ProtectiveOrderParams,
  SmartOrderResponse,
  WaitOrderStatusOptions,
} from '@syldel/hl-shared-types';
import { HyperliquidApiInfoService } from './hyperliquid-api-info.service';
import { HyperliquidApiTradeService } from './hyperliquid-api-trade.service';
import { DecimalUtilsService } from '../utils/decimal-utils.service';
import { PriceMathService } from './price-math.service';
import { AssetRegistryService } from './asset-registry.service';
import { ValueFormatterService } from './value-formatter.service';

@Injectable()
export class SmartOrderService {
  private readonly logger = new Logger(SmartOrderService.name);

  constructor(
    private readonly infoService: HyperliquidApiInfoService,
    private readonly tradeService: HyperliquidApiTradeService,
    private readonly decimalUtils: DecimalUtilsService,
    private readonly priceMath: PriceMathService,
    private readonly assetRegistry: AssetRegistryService,
    private readonly formatter: ValueFormatterService,
  ) {}

  async instantOrder(params: InstantOrderParams) {
    const {
      assetName,
      isBuy,
      size,
      reduceOnly = false,
      isTestnet = false,
      maxRetries = 6,
      delayMs = 7500,
    } = params;

    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;

      const assets = await this.infoService.getPerpMarketsWithPrices(isTestnet);
      const market = assets.find((a) => a.name === assetName);
      if (!market || !market.markPrice) {
        throw new Error(`Invalid market data for ${assetName}`);
      }

      const { below, above } = this.priceMath.getOneTickAroundPrice(
        market.markPrice,
      );
      const price: DecimalString = isBuy ? below : above;

      let sz: DecimalString;
      if (size.type === 'base') {
        sz = size.sz;
      } else if (size.type === 'quote') {
        sz = this.usdcToSize(size.usdc, price, market.szDecimals);
      } else {
        const quoteValue = await this.resolveQuoteFromPercent({
          percent: size.percent,
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
          limit: { tif: 'Alo' },
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
          throw new Error('Instant order oid undefined');
        }

        const { finalStatus, raw, timedOut } =
          await this.waitForOrderFinalStatus(this.infoService, {
            oid,
            isTestnet,
          });

        if (timedOut && finalStatus === 'open') {
          // ordre toujours ouvert → on cancel
          const cancelResult = await this.tradeService.cancelOrder(
            [{ asset: market.index, oid }],
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

          const lastStatus = await this.infoService.getOrderStatus(
            oid,
            isTestnet,
          );
          return lastStatus?.order;
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
    isTestnet?: boolean;
  }): Promise<DecimalString> {
    const { percent, isTestnet = false } = params;

    const pctValue = this.decimalUtils.parse(percent);
    if (pctValue <= 0 || pctValue > 1) {
      throw new BadRequestException({
        error: 'INVALID_ORDER_PARAMS',
        message: `percent must be between 0 and 1, got ${percent}`,
      });
    }

    const perpState = await this.infoService.getPerpAccountState(isTestnet);
    const accountValue = perpState.marginSummary.accountValue;

    if (!this.decimalUtils.isPositive(accountValue)) {
      throw new Error('No USDC collateral available');
    }

    const usdcToUse = this.decimalUtils.multiply(
      accountValue,
      percent,
      6,
      'USDC balance',
    );

    if (!this.decimalUtils.isPositive(usdcToUse)) {
      throw new Error('Computed USDC amount is zero');
    }

    return this.decimalUtils.format(this.decimalUtils.parse(usdcToUse), 6);
  }

  private mapOrderErrorToCode(errorMsg?: string): string {
    const msg = (errorMsg || '').toLowerCase();

    if (msg.includes('minimum value')) return 'ORDER_MIN_VALUE';
    if (msg.includes('insufficient margin')) return 'INSUFFICIENT_MARGIN';
    if (msg.includes('post only')) return 'POST_ONLY_REJECTED';
    if (msg.includes('ioc')) return 'IOC_REJECTED';
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
      throw new Error('No order status returned from Hyperliquid');
    }

    const status = statuses[0];

    if ('error' in status) {
      const code = this.mapOrderErrorToCode(status.error);
      throw new Error(`${code}: ${status.error}`);
    }

    // ordre placé avec succès (resting ou filled)
    return response;
  }

  /**
   * Transforme les paramètres d'un ProtectiveOrder en HLOrderDetails
   * pour Hyperliquid.
   *
   * Cette méthode est utilisée pour créer un ordre **protective** (Take Profit ou Stop Loss)
   * à partir des paramètres fournis, avec `reduceOnly` forcé à true.
   */
  public toHLOrderDetails(params: ProtectiveOrderParams): HLOrderDetails {
    return {
      assetName: params.assetName,
      isBuy: params.isBuy,
      sz: params.sz,
      limitPx: params.price,
      reduceOnly: true, // forcé pour SL / TP
      orderType: {
        trigger: {
          isMarket: params.isMarket ?? true,
          triggerPx: params.price,
          tpsl: params.kind,
        },
      },
    };
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

    const szDecimals = this.assetRegistry.getSzDecimals(m.order.assetName) ?? 6;
    const isPerp = this.assetRegistry.isPerp(m.order.assetName);

    return {
      kind: ot.trigger.tpsl,
      price: this.formatter.formatPrice(
        ot.trigger.triggerPx,
        szDecimals,
        isPerp ? 'perp' : 'spot',
      ),
      sz: this.formatter.formatSize(m.order.sz, szDecimals),
      isMarket: ot.trigger.isMarket,
    };
  }

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
      throw new Error(`Unknown asset: ${assetName}`);
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

    // 1️⃣ Fetch existing protective orders
    const openOrders = await this.infoService.getFrontendOpenOrders(
      '',
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
        price: o.triggerPx,
        sz: o.sz,
        isMarket: o.orderType.toLowerCase().includes('market'),
      }))
      .sort((a, b) => Number(a.price) - Number(b.price));

    let openOrder: HLFrontendOpenOrder | undefined;
    existing.forEach((o) => {
      openOrder = openOrders.find((r) => r.oid === o.oid);
      this.logger.log(
        `Open Order ${assetName}: ${o.oid} [${o.kind}] ${openOrder ? (openOrder.side === 'B' ? 'BUY' : 'SELL') : '?'} ${o.sz} @ ${o.price}`,
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
