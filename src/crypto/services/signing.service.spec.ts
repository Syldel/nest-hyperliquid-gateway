import { Test, TestingModule } from '@nestjs/testing';

import { Wallet } from 'ethers';

import { SigningService } from './signing.service';

describe('SigningService', () => {
  let service: SigningService;
  const PRIVATE_KEY =
    '0x822e9959e022b78423eb653a62ea0020cd283e71a2a8133a6ff2aeffaf373cff';
  let wallet: Wallet;

  const L1_ACTION = {
    action: {
      type: 'order',
      orders: [
        {
          a: 0,
          b: true,
          p: '30000',
          s: '0.1',
          r: false,
          t: { limit: { tif: 'Gtc' } },
        },
      ],
      grouping: 'na',
    },
    nonce: 1234567890,
    vaultAddress: '0x1234567890123456789012345678901234567890',
    expiresAfter: 1234567890,
    hash: {
      base: '0x25367e0dba84351148288c2233cd6130ed6cec5967ded0c0b7334f36f957cc90',
      withVault:
        '0x214e2ea3270981b6fd18174216691e69f56872663139d396b10ded319cb4bb1e',
      withExpires:
        '0xc30b002ba3775e4c31c43c1dfd3291dfc85c6ae06c6b9f393991de86cad5fac7',
      withBoth:
        '0x2d62412aa0fc57441b5189841d81554a6a9680bf07204e1454983a9ca44f0744',
    },
    signature: {
      mainnet: {
        r: '0x61078d8ffa3cb591de045438a1ae2ed299b271891d1943a33901e7cfb3a31ed8',
        s: '0x0e91df4f9841641d3322dad8d932874b74d7e082cdb5b533f804964a6963aef9',
        v: 28,
      },
      testnet: {
        r: '0x6b0283a894d87b996ad0182b86251cc80d27d61ef307449a2ed249a508ded1f7',
        s: '0x6f884e79f4a0a10af62db831af6f8e03b3f11d899eb49b352f836746ee9226da',
        v: 27,
      },
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SigningService],
    }).compile();

    service = module.get<SigningService>(SigningService);
    wallet = new Wallet(PRIVATE_KEY);
  });

  describe('createL1ActionHash', () => {
    it('hashes base action', () => {
      const hash = service.actionHash({
        action: L1_ACTION.action,
        nonce: L1_ACTION.nonce,
      });

      expect(hash).toBe(L1_ACTION.hash.base);
    });

    it('hashes action with vaultAddress', () => {
      const hash = service.actionHash({
        action: L1_ACTION.action,
        nonce: L1_ACTION.nonce,
        vaultAddress: L1_ACTION.vaultAddress,
      });

      expect(hash).toBe(L1_ACTION.hash.withVault);
    });

    it('hashes action with expiresAfter', () => {
      const hash = service.actionHash({
        action: L1_ACTION.action,
        nonce: L1_ACTION.nonce,
        expiresAfter: L1_ACTION.expiresAfter,
      });

      expect(hash).toBe(L1_ACTION.hash.withExpires);
    });

    it('hashes action with vaultAddress and expiresAfter', () => {
      const hash = service.actionHash({
        action: L1_ACTION.action,
        nonce: L1_ACTION.nonce,
        vaultAddress: L1_ACTION.vaultAddress,
        expiresAfter: L1_ACTION.expiresAfter,
      });

      expect(hash).toBe(L1_ACTION.hash.withBoth);
    });
  });

  describe('signL1Action', () => {
    it('should produce consistent signatures for the same input', async () => {
      const sig1 = await service.signL1Action({
        wallet,
        action: L1_ACTION.action,
        nonce: L1_ACTION.nonce,
        isTestnet: false,
      });
      const sig2 = await service.signL1Action({
        wallet,
        action: L1_ACTION.action,
        nonce: L1_ACTION.nonce,
        isTestnet: false,
      });
      expect(sig1.r).toBe(sig2.r);
      expect(sig1.s).toBe(sig2.s);
      expect(sig1.v).toBe(sig2.v);
    });

    it('should generate a valid L1 signature for mainnet', async () => {
      const signature = await service.signL1Action({
        wallet,
        action: L1_ACTION.action,
        nonce: L1_ACTION.nonce,
        isTestnet: false,
      });
      expect(signature.r).toBeDefined();
      expect(signature.s).toBeDefined();
      expect(signature.v).toBeGreaterThanOrEqual(27);
      expect(signature).toEqual(L1_ACTION.signature.mainnet);
    });

    it('should generate a valid L1 signature for testnet', async () => {
      const signature = await service.signL1Action({
        wallet,
        action: L1_ACTION.action,
        nonce: L1_ACTION.nonce,
        isTestnet: true,
      });
      expect(signature.r).toBeDefined();
      expect(signature.s).toBeDefined();
      expect(signature.v).toBeGreaterThanOrEqual(27);
      expect(signature).toEqual(L1_ACTION.signature.testnet);
    });
  });
});
