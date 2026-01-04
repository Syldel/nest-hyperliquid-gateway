import { Body, Controller, Post } from '@nestjs/common';

import { SmartOrderService } from '../services/smart-order.service';
import { ProtectiveOrderDto } from '../dtos/protective-order.dtos';

@Controller('orders')
export class ProtectiveOrdersController {
  constructor(private readonly smartOrderService: SmartOrderService) {}

  @Post('protective')
  async placeProtectiveOrder(@Body() dto: ProtectiveOrderDto) {
    const params = this.smartOrderService.toHLOrderDetails(dto);
    return this.smartOrderService.placeProtectiveOrder(params, dto.isTestnet);
  }
}
