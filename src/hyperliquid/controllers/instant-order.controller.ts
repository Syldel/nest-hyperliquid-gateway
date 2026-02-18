import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { HLOrderSize } from '@syldel/hl-shared-types';
import { SmartOrderService } from '../services/smart-order.service';
import { InstantOrderDto, OrderSizeDto } from '../dtos/instant-order.dtos';
import { UserAuthGuard } from '../../common/guards/user-auth.guard';

@Controller('orders')
export class InstantOrderController {
  constructor(private readonly smartOrderService: SmartOrderService) {}

  @Post('instant')
  @UseGuards(UserAuthGuard)
  async instantOrder(@Body() dto: InstantOrderDto) {
    return this.smartOrderService.instantOrder({
      assetName: dto.assetName,
      isBuy: dto.isBuy,
      size: this.mapOrderSize(dto.size),
      reduceOnly: dto.reduceOnly ?? false,
      isTestnet: dto.isTestnet,
      maxRetries: dto.maxRetries,
      delayMs: dto.delayMs,
    });
  }

  private mapOrderSize(dto: OrderSizeDto): HLOrderSize {
    switch (dto.type) {
      case 'base':
        if (!dto.sz) {
          throw new Error('sz is required when type is base');
        }
        return {
          type: 'base',
          sz: dto.sz,
        };

      case 'quote':
        if (!dto.usdc) {
          throw new Error('usdc is required when type is quote');
        }
        return {
          type: 'quote',
          usdc: dto.usdc,
        };

      case 'percent':
        if (!dto.percent) {
          throw new Error('percent is required when type is percent');
        }
        return {
          type: 'percent',
          percent: dto.percent,
        };
    }
  }
}
