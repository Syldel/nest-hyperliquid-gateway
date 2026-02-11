import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import {
  HLOpenOrdersResponse,
  HLFrontendOpenOrdersResponse,
} from '@syldel/hl-shared-types';
import {
  GetOpenOrdersQueryDto,
  OrderStatusQueryDto,
} from '../dtos/hyperliquid-order.dtos';
import { HyperliquidApiInfoService } from '../services/hyperliquid-api-info.service';
import { UserAuthGuard } from '../../common/guards/user-auth.guard';

@Controller('hyperliquid/orders')
export class HyperliquidOrdersController {
  constructor(private readonly infoService: HyperliquidApiInfoService) {}

  /**
   * GET /open
   * Open orders (simples)
   */
  @Get('open')
  @UseGuards(UserAuthGuard)
  async getOpenOrders(
    @Query() query: GetOpenOrdersQueryDto,
  ): Promise<HLOpenOrdersResponse> {
    return this.infoService.getOpenOrders(query.dex, query.isTestnet);
  }

  /**
   * GET /open/frontend
   * Open orders enrichis (frontend)
   */
  @Get('open/frontend')
  @UseGuards(UserAuthGuard)
  async getFrontendOpenOrders(
    @Query() query: GetOpenOrdersQueryDto,
  ): Promise<HLFrontendOpenOrdersResponse> {
    return this.infoService.getFrontendOpenOrders(query.dex, query.isTestnet);
  }

  /**
   * GET /open/:oid
   * Status d’un ordre
   */
  @Get('open/:oid')
  @UseGuards(UserAuthGuard)
  async getOrderStatus(
    @Param('oid') oid: string,
    @Query() query: OrderStatusQueryDto,
  ) {
    const parsedOid = oid.startsWith('0x')
      ? (oid as `0x${string}`)
      : Number(oid);

    return this.infoService.getOrderStatus(parsedOid, query.isTestnet);
  }

  /**
   * DELETE /open/:oid
   * Cancel order
   */
  // @Delete('open/:oid')
  // async cancelOrder(
  //   @Param('oid') oid: string,
  //   @Query('testnet') testnet?: string,
  // ): Promise<HLCancelResponse> {
  //   const parsedOid = Number(oid);

  //   const openOrders = await this.infoService.getOpenOrders();
  //   const openOrder = openOrders.find((o) => o.oid === parsedOid);
  //   console.log('openOrder', openOrder);

  //   return this.tradeService.cancelOrder(
  //     [{ oid: parsedOid }],
  //     testnet === 'true',
  //   );
  // }
}
