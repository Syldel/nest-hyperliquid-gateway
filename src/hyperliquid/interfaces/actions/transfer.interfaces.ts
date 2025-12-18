// export interface HLUsdSendAction {
//   type: 'usdSend';
//   hyperliquidChain: 'Mainnet' | 'Testnet';
//   signatureChainId: string;
//   destination: string;
//   amount: string;
//   time: number;
// }

export interface HLUsdClassTransferAction {
  type: 'usdClassTransfer';
  hyperliquidChain: 'Mainnet' | 'Testnet';
  signatureChainId: string;
  amount: string;
  toPerp: boolean;
  nonce: number;
}

// export interface HLWithdrawAction {
//   type: 'withdraw3';
//   hyperliquidChain: 'Mainnet' | 'Testnet';
//   signatureChainId: string;
//   amount: string;
//   time: number;
//   destination: string;
// }

export interface HLSpotSendAction {
  type: 'spotSend';
  hyperliquidChain: 'Mainnet' | 'Testnet';
  signatureChainId: string;
  destination: string;
  token: string;
  amount: string;
  time: number;
}

export interface HLSendAssetAction {
  type: 'sendAsset';
  hyperliquidChain: 'Mainnet' | 'Testnet';
  signatureChainId: string;
  destination: string;
  sourceDex: string;
  destinationDex: string;
  token: string;
  amount: string;
  fromSubAccount: string;
  nonce: number;
}

export interface HLCDepositAction {
  type: 'cDeposit';
  hyperliquidChain: 'Mainnet' | 'Testnet';
  signatureChainId: string;
  wei: number;
  nonce: number;
}

export interface HLCWithdrawAction {
  type: 'cWithdraw';
  hyperliquidChain: 'Mainnet' | 'Testnet';
  signatureChainId: string;
  wei: number;
  nonce: number;
}

export interface HLTokenDelegateAction {
  type: 'tokenDelegate';
  hyperliquidChain: 'Mainnet' | 'Testnet';
  signatureChainId: string;
  validator: string;
  isUndelegate: boolean;
  wei: number;
  nonce: number;
}

export interface HLVaultTransferAction {
  type: 'vaultTransfer';
  vaultAddress: string;
  isDeposit: boolean;
  usd: number;
}

export interface HLApproveAgentAction {
  type: 'approveAgent';
  hyperliquidChain: 'Mainnet' | 'Testnet';
  signatureChainId: string;
  agentAddress: string;
  agentName?: string;
  nonce: number;
}

export interface HLApproveBuilderFeeAction {
  type: 'approveBuilderFee';
  hyperliquidChain: 'Mainnet' | 'Testnet';
  signatureChainId: string;
  maxFeeRate: string;
  builder: string;
  nonce: number;
}

export interface HLTwapOrderAction {
  type: 'twapOrder';
  twap: {
    a: number; // asset
    b: boolean; // isBuy
    s: string; // size
    r: boolean; // reduceOnly
    m: number; // minutes
    t: boolean; // isTpsl
  };
}

export interface HLTwapCancelAction {
  type: 'twapCancel';
  a: number; // asset
  t: number; // twap ID
}

export interface HLReserveRequestWeightAction {
  type: 'reserveRequestWeight';
  weight: number;
}
