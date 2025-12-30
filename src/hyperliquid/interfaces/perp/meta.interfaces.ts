import { DecimalString } from '../orders';

export interface HLPerpMarketInfo {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
  isDelisted?: boolean;
  marginMode?: 'strictIsolated' | 'noCross';
}

export interface HLPerpMarginTier {
  lowerBound: string;
  maxLeverage: number;
}

export interface HLPerpMarginTable {
  description: string;
  marginTiers: HLPerpMarginTier[];
}

export type HLPerpMarginTableEntry = [number, HLPerpMarginTable];

export interface HLPerpMeta {
  universe: HLPerpMarketInfo[];
  marginTables: HLPerpMarginTableEntry[];
}

export interface HLPerpMarketUniverse extends HLPerpMarketInfo {
  index: number;
}

/* ********************************************************** */

export interface HLPerpAssetCtx {
  dayNtlVlm: string; // Daily notional volume
  funding: string; // Current funding rate
  impactPxs: string[]; // Price impact range
  markPx: string; // Mark price
  midPx: string; // Mid price
  openInterest: string; // Open interest
  oraclePx: string; // Oracle price
  premium: string; // Premium
  prevDayPx: string; // Previous day price
}

export type HLPerpMetaAndCtx = [
  { universe: HLPerpMarketInfo[] },
  HLPerpAssetCtx[],
];

export interface HLPerpMarket {
  index: number; // Position dans la liste du universe
  name: string; // Nom du marché, ex: BTC
  szDecimals: number; // Décimales du prix
  maxLeverage: number; // Levier max
  marginTableId?: number; // Id de la table de marge (si applicable)
  markPrice?: DecimalString; // Prix actuel du marché
  midPrice?: DecimalString; // Prix mid
  funding?: DecimalString; // Taux de funding
  openInterest?: DecimalString; // Open interest
}
