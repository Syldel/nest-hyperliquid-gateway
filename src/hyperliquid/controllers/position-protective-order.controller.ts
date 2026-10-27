import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { SmartOrderService } from '../services/smart-order.service';
import {
  ModifyPositionProtectiveOrderDto,
  PositionProtectiveOrderDto,
} from '../dtos/position-protective-order.dtos';
import { UserAuthGuard } from '../../common/guards/user-auth.guard';

/**
 * Les TP/SL « de position » : sans taille, au marché, dans le groupe `positionTpsl`. Une famille à part de
 * `protective` — aucune des routes existantes n'a changé. Voir `docs/position-level-orders.md`.
 *
 * L'annulation n'a pas de route ici : `POST /hyperliquid/order/cancel` annule un ordre de position comme un autre.
 */
@Controller('orders')
export class PositionProtectiveOrdersController {
  constructor(private readonly smartOrderService: SmartOrderService) {}

  /** Pose un stop ou un take-profit de position. */
  @Post('position-protective')
  @UseGuards(UserAuthGuard)
  async placePositionProtectiveOrder(@Body() dto: PositionProtectiveOrderDto) {
    return this.smartOrderService.placePositionProtectiveOrder(
      dto,
      dto.isTestnet,
    );
  }

  /** Modifie un ordre de position existant (nouveau déclencheur). */
  @Post('position-protective/modify')
  @UseGuards(UserAuthGuard)
  async modifyPositionProtectiveOrder(
    @Body() dto: ModifyPositionProtectiveOrderDto,
  ) {
    return this.smartOrderService.modifyPositionProtectiveOrder(
      dto.oid,
      dto,
      dto.isTestnet,
    );
  }
}
