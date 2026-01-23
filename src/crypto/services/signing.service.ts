import { Injectable } from '@nestjs/common';

import { encode as encodeMsgpack } from '@msgpack/msgpack';
import {
  Wallet,
  HDNodeWallet,
  ethers,
  keccak256,
  getBytes,
  TypedDataDomain,
} from 'ethers';
import { concatBytes } from '@noble/hashes/utils.js';

import { HLSignature } from '@syldel/hl-shared-types';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const PHANTOM_DOMAIN: TypedDataDomain = {
  name: 'Exchange',
  version: '1',
  chainId: 1337,
  verifyingContract: '0x0000000000000000000000000000000000000000',
};

const AGENT_TYPES: Record<string, Array<ethers.TypedDataField>> = {
  Agent: [
    { name: 'source', type: 'string' },
    { name: 'connectionId', type: 'bytes32' },
  ],
} as const;

/* -------------------------------------------------------------------------- */
/*                              SIGNING SERVICE                               */
/* -------------------------------------------------------------------------- */

@Injectable()
export class SigningService {
  // -----------------------------------------------------------------------------
  // L1 Action Hash (msgpack + nonce + vault marker)
  // -----------------------------------------------------------------------------

  actionHash(args: {
    action: unknown;
    nonce: number;
    vaultAddress?: string;
    expiresAfter?: number;
  }): string {
    const { action, nonce, vaultAddress, expiresAfter } = args;

    const normalizedAction = this.normalizeTrailingZeros(action);

    const actionBytes = encodeMsgpack(normalizedAction);

    // nonce (uint64 BE)
    const nonceBytes = new Uint8Array(8);
    new DataView(nonceBytes.buffer).setBigUint64(0, BigInt(nonce), false);

    // Vault
    const vaultMarker = vaultAddress
      ? new Uint8Array([1])
      : new Uint8Array([0]);

    const vaultBytes = vaultAddress
      ? this.addressToBytes(vaultAddress)
      : new Uint8Array();

    // Expires
    const expiresMarker =
      expiresAfter !== undefined ? new Uint8Array([0]) : new Uint8Array();

    const expiresBytes =
      expiresAfter !== undefined
        ? this.toUint64Bytes(expiresAfter)
        : new Uint8Array();

    // concat
    const bytes = concatBytes(
      actionBytes,
      nonceBytes,
      vaultMarker,
      vaultBytes,
      expiresMarker,
      expiresBytes,
    );

    return keccak256(bytes);
  }

  constructPhantomAgent(hash: string, isTestnet: boolean) {
    return { source: isTestnet ? 'b' : 'a', connectionId: hash };
  }

  // -----------------------------------------------------------------------------
  // Sign L1 Action
  // -----------------------------------------------------------------------------

  async signL1Action(args: {
    wallet: Wallet | HDNodeWallet;
    action: unknown;
    nonce: number;
    vaultAddress?: string;
    expiresAfter?: number;
    isTestnet: boolean;
  }): Promise<HLSignature> {
    const { wallet, action, nonce, vaultAddress, expiresAfter, isTestnet } =
      args;

    const hash = this.actionHash({
      action,
      nonce,
      vaultAddress,
      expiresAfter,
    });
    const phantomAgent = this.constructPhantomAgent(hash, isTestnet);
    const data = {
      domain: PHANTOM_DOMAIN,
      types: AGENT_TYPES,
      value: phantomAgent,
    };
    return this.signInner(wallet, data);
  }

  // -----------------------------------------------------------------------------
  // Utils
  // -----------------------------------------------------------------------------

  toUint64Bytes(n: bigint | number | string): Uint8Array {
    if (n === undefined || n === null) {
      throw new Error('nonce is required and must be defined');
    }
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, BigInt(n), false);
    return bytes;
  }

  addressToBytes(address: string): Uint8Array {
    return getBytes(address);
  }

  // -----------------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------------

  async signInner(
    wallet: Wallet | HDNodeWallet,
    data: {
      domain: TypedDataDomain;
      types: Record<string, Array<ethers.TypedDataField>>;
      value: Record<string, any>;
    },
  ): Promise<HLSignature> {
    const signature = await wallet.signTypedData(
      data.domain,
      data.types,
      data.value,
    );
    return this.splitSig(signature);
  }

  splitSig(sig: string): HLSignature {
    const { r, s, v } = ethers.Signature.from(sig);
    return { r, s, v };
  }

  normalizeTrailingZeros<T>(value: T): T {
    if (value === null || value === undefined) {
      return value;
    }

    if (Array.isArray(value)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return value.map((v) => this.normalizeTrailingZeros(v)) as T;
    }

    if (typeof value !== 'object') {
      return value;
    }

    const result: Record<string, unknown> = {};

    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v && typeof v === 'object') {
        result[key] = this.normalizeTrailingZeros(v);
        continue;
      }

      if ((key === 'p' || key === 's') && typeof v === 'string') {
        result[key] = this.removeTrailingZeros(v);
        continue;
      }

      result[key] = v;
    }

    return result as T;
  }

  removeTrailingZeros(value: string): string {
    if (!value.includes('.')) return value;

    const normalized = value.replace(/\.?0+$/, '');
    return normalized === '-0' ? '0' : normalized;
  }
}
