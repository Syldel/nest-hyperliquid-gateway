import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { TrailingStopService } from '../services/trailing-stop.service';
import { TrailingStopDto } from '../dtos/trailing-stop.dtos';
import { UserAuthGuard } from '../../common/guards/user-auth.guard';

/**
 * Le trailing stop natif d'Hyperliquid : une famille à part, aucune route existante n'a changé. Pas de modification
 * (l'exchange n'en propose pas pour ce type) ; l'annulation passe par `POST /hyperliquid/order/cancel`, par oid.
 */
@Controller('orders')
export class TrailingStopController {
  constructor(private readonly trailingStopService: TrailingStopService) {}

  /** Pose un trailing stop natif ; rend son oid et l'action signée. */
  @Post('trailing-stop')
  @UseGuards(UserAuthGuard)
  async placeTrailingStop(@Body() dto: TrailingStopDto) {
    const { isTestnet, ...params } = dto;
    return this.trailingStopService.placeTrailingStop(params, isTestnet);
  }
}
