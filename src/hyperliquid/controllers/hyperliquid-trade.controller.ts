import {
  Body,
  Controller,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  PlaceOrderDto,
  CancelOrderDto,
  UpdateLeverageDto,
  TransferSpotPerpDto,
} from '../dtos/hyperliquid.dtos';
import { HyperliquidApiTradeService } from '../services/hyperliquid-api-trade.service';

@Controller('hyperliquid')
@UsePipes(new ValidationPipe({ transform: true }))
export class HyperliquidTradeController {
  constructor(
    private readonly hyperliquidApiTradeService: HyperliquidApiTradeService,
  ) {}

  // =============================================
  // Routes pour les opérations sur les ordres
  // =============================================

  /**
   * Place un ordre.
   * @param body Données de l'ordre.
   */
  @Post('order')
  async placeOrder(@Body() body: PlaceOrderDto) {
    return this.hyperliquidApiTradeService.placeOrder(
      body.order,
      body.grouping,
      body.builder,
      body.isTestnet,
    );
  }

  /**
   * Annule un ou plusieurs ordres.
   * @param body Données de l'annulation.
   */
  @Post('order/cancel')
  async cancelOrder(@Body() body: CancelOrderDto) {
    // Conversion des propriétés pour correspondre à HLCancelAction
    const formattedCancels = body.cancels.map((cancel) => ({
      a: cancel.asset,
      o: cancel.oid,
    }));
    return this.hyperliquidApiTradeService.cancelOrder(
      formattedCancels,
      body.isTestnet,
    );
  }

  // =============================================
  // Routes pour les opérations de transfert
  // =============================================

  /**
   * Met à jour le levier d'une position.
   * @param body Données de la mise à jour.
   */
  @Post('leverage')
  async updateLeverage(@Body() body: UpdateLeverageDto) {
    return this.hyperliquidApiTradeService.updateLeverage(
      body.asset,
      body.isCross,
      body.leverage,
      body.isTestnet,
    );
  }

  /**
   * Retire des fonds vers Arbitrum.
   * @param body Données du retrait.
   */
  // @Post('withdraw/arbitrum')
  // async withdrawToArbitrum(@Body() body: WithdrawToArbitrumDto) {
  //   return this.hyperliquidService.withdrawToArbitrum(
  //     body.destination,
  //     body.amount,
  //     // body.privateKey,
  //     body.isTestnet,
  //   );
  // }

  /**
   * Transfère USDC entre Spot et Perp.
   * @param body Données du transfert.
   */
  @Post('transfer/spot-perp')
  async transferSpotPerp(@Body() body: TransferSpotPerpDto) {
    return this.hyperliquidApiTradeService.transferUsdClass(
      body.amount,
      body.toPerp,
      body.isTestnet,
    );
  }

  /**
   * Envoie USDC à une autre adresse.
   * @param body Données de l'envoi.
   */
  // @Post('send/usd')
  // async sendUsd(@Body() body: SendUsdDto) {
  //   return this.hyperliquidService.sendUsd(
  //     body.destination,
  //     body.amount,
  //     // body.privateKey,
  //     body.isTestnet,
  //   );
  // }
}
