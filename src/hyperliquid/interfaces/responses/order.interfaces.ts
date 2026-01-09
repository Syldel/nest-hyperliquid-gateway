import { HLOid } from '../orders';

export interface HLPlaceOrderStatus {
  resting?: { oid: HLOid };
  filled?: { oid: HLOid; totalSz: string; avgPx: string };
  error?: string;
}

export interface HLPlaceOrderResponse {
  type: 'order';
  data: {
    statuses: HLPlaceOrderStatus[];
  };
}
