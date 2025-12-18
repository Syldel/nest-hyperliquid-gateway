export interface HLCancelAction {
  type: 'cancel';
  cancels: Array<{
    a: number; // asset
    o: number; // order ID (oid)
  }>;
}

export interface HLCancelByCloidAction {
  type: 'cancelByCloid';
  cancels: Array<{
    asset: number;
    cloid: string;
  }>;
}
