import { DecimalString } from '../orders';

export type HLProtectiveKind = 'tp' | 'sl';

export interface ProtectiveOrderParams {
  assetName: string;
  kind: HLProtectiveKind; // 'tp' | 'sl'
  isBuy: boolean; // sens de l'ordre de fermeture
  sz: DecimalString;
  price: DecimalString;
  isMarket?: boolean; // default true
  isTestnet?: boolean;
}
