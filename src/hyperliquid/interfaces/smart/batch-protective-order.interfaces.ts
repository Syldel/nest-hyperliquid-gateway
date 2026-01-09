import { DecimalString, HLOid, HLOrderDetails } from '../orders';
import { HLProtectiveKind } from './protective-order.interfaces';

export interface BatchProtectiveOrderItem {
  sz: string;
  price: string;
  isMarket?: boolean;
}

export interface BatchProtectiveOrders {
  assetName: string;
  isBuy: boolean;
  tp?: BatchProtectiveOrderItem[];
  sl?: BatchProtectiveOrderItem[];
}

export interface ExistingProtectiveOrder {
  oid: HLOid;
  kind: HLProtectiveKind;
  price: DecimalString;
  sz: DecimalString;
  isMarket: boolean;
}

export interface NormalizedProtectiveOrder {
  kind: HLProtectiveKind;
  price: DecimalString;
  sz: DecimalString;
  isMarket?: boolean;
}

export interface HLModifyInput {
  oid: HLOid;
  order: HLOrderDetails;
}
