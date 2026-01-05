export interface HLUserFill {
  coin: string; // e.g. "BTC" or "@107" for spot
  px: string;
  sz: string;
  side: 'A' | 'B';
  time: number;
  oid: number;
  tid: number;

  dir: string;
  startPosition: string;
  closedPnl: string;

  crossed: boolean;
  hash: `0x${string}`;

  fee: string;
  feeToken: string;

  builderFee?: string; // optional
}

export type HLUserFillsResponse = HLUserFill[];
