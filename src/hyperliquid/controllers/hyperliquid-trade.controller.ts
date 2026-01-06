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
import {
  BatchModifyOrdersDto,
  ModifyOrderDto,
} from '../dtos/hyperliquid-modify-order.dtos';
import { HLOrderTypeDto } from '../dtos/hyperliquid-order-details.dtos';
import { HyperliquidApiTradeService } from '../services/hyperliquid-api-trade.service';
import { HLOrderDetails } from '../interfaces';

@Controller('hyperliquid')
@UsePipes(new ValidationPipe({ transform: true }))
export class HyperliquidTradeController {
  constructor(private readonly tradeService: HyperliquidApiTradeService) {}

  // =============================================
  // Routes pour les opérations sur les ordres
  // =============================================

  /**
   * Place un ordre.
   * @param body Données de l'ordre.
   */
  @Post('order')
  async placeOrder(@Body() body: PlaceOrderDto) {
    const order: HLOrderDetails = {
      ...body.order,
      orderType: this.mapOrderType(body.order.orderType),
    };
    return this.tradeService.placeOrder({
      order,
      grouping: body.grouping,
      builder: body.builder,
      isTestnet: body.isTestnet,
    });
  }

  /**
   * Annule un ou plusieurs ordres.
   * @param body Données de l'annulation.
   */
  @Post('order/cancel')
  async cancelOrder(@Body() body: CancelOrderDto) {
    return this.tradeService.cancelOrder(body.cancels, body.isTestnet);
  }

  /**
   * Modifie un ordre unique
   */
  @Post('order/modify')
  async modifyOrder(@Body() body: ModifyOrderDto) {
    const order: HLOrderDetails = {
      ...body.order,
      orderType: this.mapOrderType(body.order.orderType),
    };
    const isTestnet = body.isTestnet ?? false;
    return this.tradeService.modifyOrder(body.oid, order, isTestnet);
  }

  /**
   * Modifie plusieurs ordres en batch
   */
  @Post('order/batch-modify')
  async batchModifyOrders(@Body() body: BatchModifyOrdersDto) {
    const modifies = body.modifies.map((modify) => {
      return {
        oid: modify.oid,
        order: {
          ...modify.order,
          orderType: this.mapOrderType(modify.order.orderType),
        },
      };
    });
    const isTestnet = body.isTestnet ?? false;
    return this.tradeService.batchModifyOrders(modifies, isTestnet);
  }

  private mapOrderType(dto: HLOrderTypeDto): HLOrderDetails['orderType'] {
    if (dto.trigger) {
      return { trigger: dto.trigger };
    }

    if (dto.limit) {
      return { limit: dto.limit };
    }

    throw new Error('Invalid orderType: either limit or trigger is required');
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
    return this.tradeService.updateLeverage(
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
    return this.tradeService.transferUsdClass(
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
