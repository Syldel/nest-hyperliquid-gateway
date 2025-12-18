export interface HLSpotTokenMeta {
  name: string;
  szDecimals: number;
  weiDecimals: number;
  index: number;
  tokenId: string;
  isCanonical: boolean;
  evmContract: string | null;
  fullName: string | null;
}

export interface HLSpotMarketMeta {
  name: string;
  tokens: [number, number];
  index: number;
  isCanonical: boolean;
}

export interface HLSpotMeta {
  tokens: HLSpotTokenMeta[];
  universe: HLSpotMarketMeta[];
}

export interface HLSpotAssetSummary extends HLSpotMarketMeta {
  szDecimals?: number;
}
