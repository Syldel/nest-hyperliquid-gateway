export type HLOrderStatus =
  | 'open'
  | 'filled'
  | 'canceled'
  | 'triggered'
  | 'rejected'
  | 'marginCanceled'
  | 'vaultWithdrawalCanceled'
  | 'openInterestCapCanceled'
  | 'selfTradeCanceled'
  | 'reduceOnlyCanceled'
  | 'siblingFilledCanceled'
  | 'delistedCanceled'
  | 'liquidatedCanceled'
  | 'scheduledCancel'
  | 'tickRejected'
  | 'minTradeNtlRejected'
  | 'perpMarginRejected'
  | 'reduceOnlyRejected'
  | 'badAloPxRejected'
  | 'iocCancelRejected'
  | 'badTriggerPxRejected'
  | 'marketOrderNoLiquidityRejected'
  | 'positionIncreaseAtOpenInterestCapRejected'
  | 'positionFlipAtOpenInterestCapRejected'
  | 'tooAggressiveAtOpenInterestCapRejected'
  | 'openInterestIncreaseRejected'
  | 'insufficientSpotBalanceRejected'
  | 'oracleRejected'
  | 'perpMaxPositionRejected';

export interface HLOrderStatusDetails {
  coin: string;
  side: 'A' | 'B';
  limitPx: string;
  sz: string;
  oid: number;
  timestamp: number;
  triggerCondition: string;
  isTrigger: boolean;
  triggerPx: string;
  children: unknown[];
  isPositionTpsl: boolean;
  reduceOnly: boolean;
  orderType: string;
  origSz: string;
  tif: string;
  cloid: string | null;
}

export interface HLOrderStatusData {
  order: HLOrderStatusDetails;
  status: HLOrderStatus;
  statusTimestamp: number;
}

export interface HLOrderStatusResponse {
  status: 'order' | 'unknownOid';
  order: HLOrderStatusData;
}

export interface HLOrderStatusRequest {
  type: 'orderStatus';
  user: `0x${string}`;
  oid: number | `0x${string}`;
}
