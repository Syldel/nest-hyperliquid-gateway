import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { UserClient } from './user-client.service';
import { CryptoService } from '../crypto/services/crypto.service';

describe('UserClient', () => {
  let service: UserClient;
  let cryptoService: CryptoService;
  const OLD_ENV = process.env;

  const userId = 'user-123';
  const rawKey = '0xprivatekey';
  const encryptedKey = { data: 'enc', iv: 'iv', tag: 'tag' };
  const fetchResponse = {
    encryptedData: encryptedKey.data,
    iv: encryptedKey.iv,
    tag: encryptedKey.tag,
  };

  beforeEach(async () => {
    jest.resetModules();
    process.env = { ...OLD_ENV };

    process.env.JWT_SERVICE_SECRET = 'service-secret';
    process.env.NEST_USER_SERVICE_URL = 'http://user-service';
    process.env.AGENT_ENCRYPTION_SECRET = 'master-secret';

    const module: TestingModule = await Test.createTestingModule({
      providers: [UserClient, CryptoService],
    }).compile();

    service = module.get<UserClient>(UserClient);
    cryptoService = module.get<CryptoService>(CryptoService);

    global.fetch = jest.fn();
    jest.useFakeTimers();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('getDecryptedAgentKey', () => {
    it('should fetch, decrypt and store in cache when not present', async () => {
      const decryptSpy = jest.spyOn(cryptoService, 'decrypt');
      decryptSpy.mockReturnValue(rawKey);
      const encryptSpy = jest.spyOn(cryptoService, 'encrypt');
      encryptSpy.mockReturnValue(encryptedKey);

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(fetchResponse),
      });

      const result = await service.getDecryptedAgentKey(userId);

      expect(result).toBe(rawKey);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/internal/users/${userId}/agent-credentials`),
        expect.any(Object),
      );
      expect(decryptSpy).toHaveBeenCalledWith(
        encryptedKey,
        process.env.AGENT_ENCRYPTION_SECRET,
      );
      expect(encryptSpy).toHaveBeenCalledWith(rawKey, expect.any(Buffer));
    });

    it('should return value from cache and skip fetch on second call', async () => {
      const decryptSpy = jest.spyOn(cryptoService, 'decrypt');
      decryptSpy.mockReturnValue(rawKey);

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(fetchResponse),
      });

      await service.getDecryptedAgentKey(userId);
      const result = await service.getDecryptedAgentKey(userId);

      expect(result).toBe(rawKey);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(decryptSpy).toHaveBeenCalledTimes(2);

      const [firstPayload, firstKey] = decryptSpy.mock.calls[0];
      const [secondPayload, secondKey] = decryptSpy.mock.calls[1];

      expect(firstKey).toBe(process.env.AGENT_ENCRYPTION_SECRET);
      expect(secondKey).toBeInstanceOf(Buffer);
      expect(secondKey).not.toEqual(Buffer.from(firstKey as string, 'hex'));

      expect(firstPayload).toEqual(encryptedKey);
      expect(secondPayload).not.toEqual(encryptedKey);
    });

    it('should fetch again after cache expiration (24h)', async () => {
      const decryptSpy = jest.spyOn(cryptoService, 'decrypt');
      decryptSpy.mockReturnValue(rawKey);

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(fetchResponse),
      });

      await service.getDecryptedAgentKey(userId);

      jest.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);

      await service.getDecryptedAgentKey(userId);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(decryptSpy).toHaveBeenCalledTimes(2);
    });

    it('should throw NotFoundException when user service returns 404', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(service.getDecryptedAgentKey(userId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw InternalServerErrorException on fetch failure', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(service.getDecryptedAgentKey(userId)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
