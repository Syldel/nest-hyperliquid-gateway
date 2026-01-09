import { DecimalString } from '../orders/order-details.interfaces';

export type Timestamp = number;

export interface HLPerpLeverage {
  rawUsd: DecimalString;
  type: 'isolated' | 'cross';
  value: number;
}

export interface HLPerpCumFunding {
  allTime: DecimalString;
  sinceChange: DecimalString;
  sinceOpen: DecimalString;
}

export interface HLPerpPositionDetail {
  coin: string;
  cumFunding: HLPerpCumFunding;
  entryPx: DecimalString;
  leverage: HLPerpLeverage;
  liquidationPx: DecimalString;
  marginUsed: DecimalString;
  maxLeverage: number;
  positionValue: DecimalString;
  returnOnEquity: DecimalString;
  szi: DecimalString; // szi > 0 → Long / szi < 0 → Short
  unrealizedPnl: DecimalString;
}

export interface HLPerpAssetPosition {
  position: HLPerpPositionDetail | null;
  type: 'oneWay' | 'hedged';
}

export interface HLPerpMarginSummary {
  accountValue: DecimalString;
  totalMarginUsed: DecimalString;
  totalNtlPos: DecimalString;
  totalRawUsd: DecimalString;
}

export interface HLClearinghouseState {
  assetPositions: HLPerpAssetPosition[];
  crossMaintenanceMarginUsed: DecimalString;
  crossMarginSummary: HLPerpMarginSummary;
  marginSummary: HLPerpMarginSummary;
  time: Timestamp;
  withdrawable: DecimalString;
}
