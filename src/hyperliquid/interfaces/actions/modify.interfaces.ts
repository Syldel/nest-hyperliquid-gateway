import { HLOrderDetails } from '../orders/order-details.interfaces';

export interface HLModifyAction {
  type: 'modify';
  oid: number | string;
  order: HLOrderDetails;
}

export interface HLBatchModifyAction {
  type: 'batchModify';
  modifies: Array<{
    oid: number | string;
    order: HLOrderDetails;
  }>;
}

export interface HLUpdateLeverageAction {
  type: 'updateLeverage';
  asset: number;
  isCross: boolean;
  leverage: number;
}

export interface HLUpdateIsolatedMarginAction {
  type: 'updateIsolatedMargin';
  asset: number;
  isBuy: boolean;
  ntli: number; // Notional leverage
}
