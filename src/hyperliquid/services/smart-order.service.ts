import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';

import {
  DecimalString,
  HLOrderStatusData,
  HLOrderStatusResponse,
  HLPlaceOrderResponse,
  InstantOrderParams,
  WaitOrderStatusOptions,
} from '../interfaces';
import { HyperliquidApiInfoService } from './hyperliquid-api-info.service';
import { HyperliquidApiTradeService } from './hyperliquid-api-trade.service';
import { DecimalUtilsService } from '../utils/decimal-utils.service';
import { PriceMathService } from './price-math.service';

@Injectable()
export class SmartOrderService {
  private readonly logger = new Logger(SmartOrderService.name);

  constructor(
    private readonly infoService: HyperliquidApiInfoService,
    private readonly tradeService: HyperliquidApiTradeService,
    private readonly decimalUtils: DecimalUtilsService,
    private readonly priceMath: PriceMathService,
  ) {}

  async instantOrder(params: InstantOrderParams) {
    const {
      assetName,
      isBuy,
      size,
      isTestnet = false,
      maxRetries = 6,
      delayMs = 2000,
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
        sz = await this.resolveQuoteFromPercent({
          percent: size.percent,
          isTestnet,
        });
      }

      try {
        const order = await this.tradeService.placeOrder({
          order: {
            assetName,
            isBuy,
            sz,
            limitPx: price.toString(),
            reduceOnly: false,
            orderType: {
              limit: { tif: 'Alo' },
            },
          },
          isTestnet,
        });

        if (this.shouldRetryOrder(order.response)) {
          // log et retry
        } else {
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
            await this.tradeService.cancelOrder(
              [{ asset: market.index, oid }],
              isTestnet,
            );
            //console.log(`Order ${oid} canceled due to timeout`);
          } else if (finalStatus === 'filled' || finalStatus === 'triggered') {
            //console.log(`Order ${oid} executed successfully`);
          } else {
            //console.error(`Order ${oid} failed with status ${finalStatus}`);
          }

          return raw;
        }
      } catch (err) {
        console.error('err', err);
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

  private shouldRetryOrder(response: HLPlaceOrderResponse): boolean {
    const statuses = response.data.statuses;

    for (const s of statuses) {
      if ('error' in s) {
        return true; // ordre rejeté → on peut retenter
      }
      if ('resting' in s) {
        return false; // ordre placé → pas besoin de repasser
      }
      if ('filled' in s) {
        return false; // ordre exécuté → pas besoin de repasser
      }
    }

    // si aucun status détecté (cas improbable)
    return true;
  }

  async waitForOrderFinalStatus(
    infoService: {
      getOrderStatus: (
        oid: number | `0x${string}`,
        isTestnet?: boolean,
      ) => Promise<HLOrderStatusResponse>;
    },
    options: WaitOrderStatusOptions,
  ): Promise<{
    finalStatus: string;
    raw: HLOrderStatusData;
    timedOut: boolean;
  }> {
    const {
      oid,
      isTestnet,
      timeoutMs = 30_000,
      pollIntervalMs = 5_000,
    } = options;

    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const status = await infoService.getOrderStatus(oid, isTestnet);
      if (!status || status.status === 'unknownOid') {
        await this.sleep(pollIntervalMs);
        continue;
      }

      const s = status.order.status;

      // État exécuté
      if (s === 'filled' || s === 'triggered') {
        return { finalStatus: s, raw: status.order, timedOut: false };
      }

      // État rejeté/cancelé
      if (
        s.endsWith('Canceled') ||
        s.endsWith('Rejected') ||
        s === 'canceled' ||
        s === 'rejected'
      ) {
        return { finalStatus: s, raw: status.order, timedOut: false };
      }

      // open = toujours en book
      await this.sleep(pollIntervalMs);
    }

    // timeout dépassé, retourne le dernier status (probablement open)
    const lastStatus = await infoService.getOrderStatus(oid, isTestnet);

    return {
      finalStatus: lastStatus?.order?.status ?? 'unknownOid',
      raw: lastStatus?.order,
      timedOut: true,
    };
  }

  sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
