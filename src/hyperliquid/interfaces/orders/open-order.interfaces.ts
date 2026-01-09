import { DecimalString } from './order-details.interfaces';

// Info : HLOid est l’ID d’un ordre, pas d’un fill ou d’une position
export type HLOid = number | `0x${string}`;

/* ****************************** Open Orders (simple) ****************************** */

export interface HLOpenOrder {
  coin: string;
  limitPx: DecimalString;
  oid: HLOid;
  side: 'A' | 'B'; // A = Ask (sell), B = Bid (buy)
  sz: DecimalString;
  timestamp: number;
}

export type HLOpenOrdersResponse = HLOpenOrder[];

/* *************** Frontend Open Orders (avec infos supplémentaires) *************** */

export interface HLFrontendOpenOrder extends HLOpenOrder {
  isPositionTpsl: boolean;
  isTrigger: boolean;
  orderType: 'Limit' | 'Market';
  origSz: DecimalString;
  reduceOnly: boolean;
  triggerCondition: string;
  triggerPx: DecimalString;
}

export type HLFrontendOpenOrdersResponse = HLFrontendOpenOrder[];
