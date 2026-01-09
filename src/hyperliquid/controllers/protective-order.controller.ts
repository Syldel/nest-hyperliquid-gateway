import { Body, Controller, Post } from '@nestjs/common';

import { SmartOrderService } from '../services/smart-order.service';
import {
  BatchProtectiveOrdersDto,
  ProtectiveOrderDto,
} from '../dtos/protective-order.dtos';

@Controller('orders')
export class ProtectiveOrdersController {
  constructor(private readonly smartOrderService: SmartOrderService) {}

  /**
   * Places a protective order (Take Profit or Stop Loss) on an existing position.
   *
   * - Creates a reduce-only trigger order (TP or SL)
   * - Supports market or limit trigger execution
   */
  @Post('protective')
  async placeProtectiveOrder(@Body() dto: ProtectiveOrderDto) {
    const params = this.smartOrderService.toHLOrderDetails(dto);
    return this.smartOrderService.placeProtectiveOrder(params, dto.isTestnet);
  }

  /**
   * Place batch protective orders (TP / SL)
   *
   * - Orders are reduce-only
   * - Supports multiple TP and SL
   * - One asset per call
   */
  @Post('batch-protective')
  async placeBatchProtectiveOrders(@Body() body: BatchProtectiveOrdersDto) {
    return this.smartOrderService.placeBatchProtectiveOrders(
      {
        assetName: body.assetName,
        isBuy: body.isBuy,
        tp: body.tp,
        sl: body.sl,
      },
      body.isTestnet,
    );
  }
}
