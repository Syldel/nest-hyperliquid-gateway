import { Test, TestingModule } from '@nestjs/testing';
import { CryptoService, EncryptedData } from './crypto.service';
import * as crypto from 'crypto';

describe('CryptoService', () => {
  let service: CryptoService;
  const masterSecret = crypto.randomBytes(32);
  const sessionKey = crypto.randomBytes(32);
  const rawText = '0xabc123privatekey';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CryptoService],
    }).compile();

    service = module.get<CryptoService>(CryptoService);
  });

  describe('encrypt/decrypt with sessionKey (Buffer)', () => {
    it('should encrypt and decrypt correctly', () => {
      const encrypted = service.encrypt(rawText, sessionKey);

      expect(encrypted).toHaveProperty('data');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('tag');

      const decrypted = service.decrypt(encrypted, sessionKey);
      expect(decrypted).toBe(rawText);
    });
  });

  describe('encrypt/decrypt with masterSecret (string)', () => {
    it('should handle string keys by hashing them', () => {
      const encrypted = service.encrypt(rawText, masterSecret);
      const decrypted = service.decrypt(encrypted, masterSecret);

      expect(decrypted).toBe(rawText);
    });
  });

  describe('Security and Integrity', () => {
    it('should throw error if tag is tampered', () => {
      const encrypted = service.encrypt(rawText, sessionKey);
      const tampered: EncryptedData = {
        ...encrypted,
        tag: crypto.randomBytes(16).toString('hex'),
      };

      expect(() => service.decrypt(tampered, sessionKey)).toThrow();
    });

    it('should throw error if data is tampered', () => {
      const encrypted = service.encrypt(rawText, sessionKey);
      const tampered: EncryptedData = {
        ...encrypted,
        data: crypto.randomBytes(32).toString('hex'),
      };

      expect(() => service.decrypt(tampered, sessionKey)).toThrow();
    });

    it('should produce different IVs for same input', () => {
      const enc1 = service.encrypt(rawText, sessionKey);
      const enc2 = service.encrypt(rawText, sessionKey);

      expect(enc1.iv).not.toBe(enc2.iv);
    });
  });
});
