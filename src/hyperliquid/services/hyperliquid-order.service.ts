import { Injectable } from '@nestjs/common';
import { HyperliquidApiInfoService } from './hyperliquid-api-info.service';
import { HyperliquidApiTradeService } from './hyperliquid-api-trade.service';
import { HLOrderDetails } from '../interfaces';

@Injectable()
export class HyperliquidOrderService {
  constructor(
    private readonly infoService: HyperliquidApiInfoService,
    private readonly tradeService: HyperliquidApiTradeService,
  ) {}

  async placePerpOrderByPercentage(params: {
    assetName: string; // "ETH", "BTC", "SOL", etc.
    percent: number; // 0.1 = 10%
    isBuy: boolean; // true = long, false = short
    isTestnet?: boolean;
  }) {
    const { assetName, percent, isBuy, isTestnet = false } = params;

    if (percent <= 0 || percent > 1) {
      throw new Error('percent must be between 0 and 1');
    }

    // 1. Fetch USDC perp balance
    const perpState = await this.infoService.getPerpAccountState(isTestnet);
    console.log('perpState', perpState);
    const usdcBalance = Number(perpState.marginSummary.accountValue);
    console.log('usdcBalance', usdcBalance);

    if (isNaN(usdcBalance)) {
      throw new Error('Invalid USDC balance');
    }

    if (!usdcBalance || usdcBalance <= 0) {
      throw new Error('No USDC collateral available');
    }

    const usdcToUse = usdcBalance * percent;
    console.log('usdcToUse', usdcBalance, '*', percent, '=', usdcToUse);

    // 2. Fetch assets to find the target market
    const assets = await this.infoService.getPerpMarketsWithPrices(isTestnet);
    const market = assets.find((a) => a.name === assetName);

    if (!market) {
      throw new Error(`Market ${assetName} not found`);
    }
    console.log('market', market);

    if (!market.markPrice) {
      console.log('Mark price:', market.markPrice);
      throw new Error(`Mark price: ${market.markPrice}`);
    }

    const markPrice = market.markPrice ?? 0;
    const assetIndex = market.index;
    console.log('assetIndex', assetIndex);

    // 3. Convert USDC size -> quantity in asset units
    const size = usdcToUse / markPrice;

    if (size <= 0) {
      throw new Error('Order size is too small');
    }

    // 4. Construct order
    const order: HLOrderDetails = {
      assetName,
      isBuy: isBuy,
      sz: size.toString(),
      limitPx: markPrice.toString(), // marketable limit order
      reduceOnly: false,
      orderType: { limit: { tif: 'Alo' } },
      // cloid: 128-bit hexadecimal string,
    };

    console.log('order', order);

    const response = await this.tradeService.placeOrder(order);
    console.log(response);
  }
}
