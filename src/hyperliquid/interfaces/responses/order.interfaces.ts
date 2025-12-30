export interface HLPlaceOrderStatus {
  resting?: { oid: number };
  filled?: { oid: number; totalSz: string; avgPx: string };
  error?: string;
}

export interface HLPlaceOrderResponse {
  type: 'order';
  data: {
    statuses: HLPlaceOrderStatus[];
  };
}
