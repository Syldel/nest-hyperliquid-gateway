import { PositionProtectiveOrdersController } from './position-protective-order.controller';
import { HLProtectiveKind } from '../dtos/protective-order.dtos';
import {
  ModifyPositionProtectiveOrderDto,
  PositionProtectiveOrderDto,
} from '../dtos/position-protective-order.dtos';

const stop: PositionProtectiveOrderDto = {
  assetName: 'ETH',
  kind: HLProtectiveKind.SL,
  isBuy: false,
  price: '2307.2',
};

function controllerOver() {
  const smartOrderService = {
    placePositionProtectiveOrder: jest.fn().mockResolvedValue({ status: 'ok' }),
    modifyPositionProtectiveOrder: jest
      .fn()
      .mockResolvedValue({ status: 'ok' }),
  };
  return {
    controller: new PositionProtectiveOrdersController(
      smartOrderService as never,
    ),
    smartOrderService,
  };
}

describe('PositionProtectiveOrdersController', () => {
  it('hands the stop to the service, with its testnet flag', async () => {
    const { controller, smartOrderService } = controllerOver();

    const answer = await controller.placePositionProtectiveOrder({
      ...stop,
      isTestnet: true,
    });

    expect(answer).toEqual({ status: 'ok' });
    expect(smartOrderService.placePositionProtectiveOrder).toHaveBeenCalledWith(
      { ...stop, isTestnet: true },
      true,
    );
  });

  it('hands a modification to the service with the oid on its own', async () => {
    const { controller, smartOrderService } = controllerOver();
    const dto: ModifyPositionProtectiveOrderDto = {
      ...stop,
      oid: 586699627884,
    };

    await controller.modifyPositionProtectiveOrder(dto);

    expect(
      smartOrderService.modifyPositionProtectiveOrder,
    ).toHaveBeenCalledWith(586699627884, dto, undefined);
  });
});
