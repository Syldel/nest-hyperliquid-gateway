import { Body, Controller, Post } from '@nestjs/common';
import { HyperliquidOrderService } from '../services/hyperliquid-order.service';

@Controller('hyperliquid')
export class HyperliquidOrderController {
  constructor(private readonly orderService: HyperliquidOrderService) {}

  @Post('perp/order')
  async placeFlexibleOrder(
    @Body()
    body: {
      asset: string;
      percent: number;
      isBuy: boolean;
      testnet?: boolean;
    },
  ) {
    return this.orderService.placePerpOrderByPercentage({
      assetName: body.asset,
      percent: body.percent,
      isBuy: body.isBuy,
      isTestnet: body.testnet ?? false,
    });
  }
}
