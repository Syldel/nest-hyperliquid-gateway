import { HLApiOrder } from '../orders/order-details.interfaces';

export type HLOrderGrouping = 'na' | 'normalTpsl' | 'positionTpsl';
export type HLOrderBuilder = { b: string; f: number };

export interface HLOrderAction {
  type: 'order';
  orders: HLApiOrder[];
  grouping: HLOrderGrouping;
  builder?: HLOrderBuilder;
}
