export interface HLSignature {
  v: number;
  r: string;
  s: string;
}

/** ECDSA signature components. */
// export interface Signature {
//   /** First 32-byte component of ECDSA signature */
//   r: `0x${string}`;
//   /** Second 32-byte component of ECDSA signature */
//   s: `0x${string}`;
//   /** Recovery identifier */
//   v: 27 | 28;
// }

export interface HLParams<T> {
  action: T;
  nonce: number;
  signature: HLSignature;
  vaultAddress?: string | null;
  expiresAfter?: number;
}
