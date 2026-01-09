import { HLApiOrder, HLOid } from '../orders';

export interface HLModifyAction {
  type: 'modify';
  oid: HLOid;
  order: HLApiOrder;
}

export interface HLBatchModifyAction {
  type: 'batchModify';
  modifies: Array<{
    oid: HLOid;
    order: HLApiOrder;
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
