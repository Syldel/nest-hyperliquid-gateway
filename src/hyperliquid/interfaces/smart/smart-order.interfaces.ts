import { DecimalString, HLOid } from '../orders';

export type HLOrderSize =
  | { type: 'base'; sz: DecimalString }
  | { type: 'quote'; usdc: DecimalString }
  | { type: 'percent'; percent: DecimalString };

export interface InstantOrderParams {
  assetName: string; // "BTC", "HYPE/USDC", "test:ABC", etc.
  isBuy: boolean; // Maybe change to: side: 'long' | 'short' ?
  size: HLOrderSize;
  reduceOnly?: boolean;
  isTestnet?: boolean;
  maxRetries?: number;
  delayMs?: number;
}

export interface WaitOrderStatusOptions {
  oid: HLOid;
  timeoutMs?: number;
  pollIntervalMs?: number;
  isTestnet?: boolean;
}
