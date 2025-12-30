import { DecimalString } from '../orders';

export type HLOrderSize =
  | { type: 'base'; sz: DecimalString }
  | { type: 'quote'; usdc: DecimalString }
  | { type: 'percent'; percent: DecimalString };

export interface InstantOrderParams {
  assetName: string; // "BTC", "HYPE/USDC", "test:ABC", etc.
  isBuy: boolean; // Maybe change to: side: 'long' | 'short' ?
  size: HLOrderSize;
  isTestnet?: boolean;
  maxRetries?: number;
  delayMs?: number;
}

export interface WaitOrderStatusOptions {
  oid: number | `0x${string}`;
  timeoutMs?: number;
  pollIntervalMs?: number;
  isTestnet?: boolean;
}
