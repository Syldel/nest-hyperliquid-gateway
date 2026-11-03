import { Test, TestingModule } from '@nestjs/testing';
import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { JweUtil } from '@syldel/crypto-utils';
import { randomBytes } from 'crypto';
import { UserClient } from './user-client.service';
import { agentKeyContext } from './agent-key';

/**
 * Le chiffrement est réel : les clés sont scellées comme set-agent-key les
 * scelle (nest-mongo-user), et seul `fetch` est remplacé. Les réponses
 * reprennent celles de nest-mongo-user : `{ agentKey }` en 200, et le corps
 * d'erreur standard de Nest (`statusCode`, `message`, `error`) sinon.
 */
describe('UserClient', () => {
  const OLD_ENV = process.env;
  const userId = '6650a1b2c3d4e5f6a7b8c9d0';
  const agentPrivateKey = '0x' + 'ab'.repeat(32);
  const masterKey = randomBytes(32);

  const sealFor = (forUserId: string, kid = '2026-11', key = masterKey) =>
    JweUtil.seal(agentPrivateKey, {
      kid,
      key,
      context: agentKeyContext(forUserId),
    });

  const ok = (body: unknown) => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
  const failure = (status: number, message: string, error: string) => ({
    ok: false,
    status,
    json: () => Promise.resolve({ statusCode: status, message, error }),
    text: () =>
      Promise.resolve(JSON.stringify({ statusCode: status, message, error })),
  });

  async function createClient(keys: string | undefined): Promise<UserClient> {
    if (keys === undefined) delete process.env.AGENT_ENCRYPTION_KEYS;
    else process.env.AGENT_ENCRYPTION_KEYS = keys;

    const module: TestingModule = await Test.createTestingModule({
      providers: [UserClient],
    }).compile();
    const client = module.get(UserClient);
    client.onModuleInit();
    return client;
  }

  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    process.env.JWT_SERVICE_SECRET = 'b2'.repeat(32);
    process.env.NEST_USER_SERVICE_URL = 'http://user-service';
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  describe('keyring at startup', () => {
    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['malformed', 'no-colon-here'],
      ['with a short key', `2026-11:${masterKey.toString('hex').slice(2)}`],
    ])('should refuse to start with a %s keyring', async (_label, keys) => {
      await expect(createClient(keys)).rejects.toThrow('Invalid keyring');
    });
  });

  describe('getDecryptedAgentKey', () => {
    const keyring = `2026-11:${masterKey.toString('hex')}`;

    it('should fetch the sealed key and open it for this user', async () => {
      const client = await createClient(keyring);
      fetchMock.mockResolvedValueOnce(ok({ agentKey: sealFor(userId) }));

      await expect(client.getDecryptedAgentKey(userId)).resolves.toBe(
        agentPrivateKey,
      );
      expect(fetchMock).toHaveBeenCalledWith(
        `http://user-service/internal/users/${userId}/agent-credentials`,
        expect.any(Object),
      );
    });

    it('should open a key sealed under an older kid still in the keyring', async () => {
      const older = randomBytes(32);
      const client = await createClient(
        `${keyring},2025-02:${older.toString('hex')}`,
      );
      fetchMock.mockResolvedValueOnce(
        ok({ agentKey: sealFor(userId, '2025-02', older) }),
      );

      await expect(client.getDecryptedAgentKey(userId)).resolves.toBe(
        agentPrivateKey,
      );
    });

    it('should serve the second call from the cache, which never holds the key in clear', async () => {
      const client = await createClient(keyring);
      fetchMock.mockResolvedValueOnce(ok({ agentKey: sealFor(userId) }));

      await client.getDecryptedAgentKey(userId);
      await expect(client.getDecryptedAgentKey(userId)).resolves.toBe(
        agentPrivateKey,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const cache = (client as unknown as { keyCache: Map<string, string> })
        .keyCache;
      expect([...cache.values()].join()).not.toContain(agentPrivateKey);
    });

    it('should fetch again after the cache expires (7 days)', async () => {
      const client = await createClient(keyring);
      fetchMock.mockResolvedValue(ok({ agentKey: sealFor(userId) }));

      await client.getDecryptedAgentKey(userId);
      jest.advanceTimersByTime(7 * 24 * 60 * 60 * 1000 + 1);
      await client.getDecryptedAgentKey(userId);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    // Le cas que le contexte existe pour arrêter : une clé recopiée en base
    // d'un utilisateur sur un autre.
    it('should refuse a key sealed for another user, and say so', async () => {
      const client = await createClient(keyring);
      fetchMock.mockResolvedValueOnce(
        ok({ agentKey: sealFor('another-user-id') }),
      );

      await expect(client.getDecryptedAgentKey(userId)).rejects.toThrow(
        new InternalServerErrorException(
          `Agent key could not be opened: Context mismatch: sealed for "hl-agent-key:another-user-id", expected "hl-agent-key:${userId}"`,
        ),
      );
    });

    it('should name a kid missing from the keyring', async () => {
      const client = await createClient(keyring);
      fetchMock.mockResolvedValueOnce(
        ok({ agentKey: sealFor(userId, '2027-01', randomBytes(32)) }),
      );

      await expect(client.getDecryptedAgentKey(userId)).rejects.toThrow(
        'Agent key could not be opened: Unknown key id: "2027-01"',
      );
    });

    it('should refuse an answer without an agent key string', async () => {
      const client = await createClient(keyring);
      fetchMock.mockResolvedValueOnce(ok({ data: 'aa', iv: 'bb', tag: 'cc' }));

      await expect(client.getDecryptedAgentKey(userId)).rejects.toThrow(
        'User service answered without an agent key string',
      );
    });

    it('should throw NotFoundException when the user service answers 404', async () => {
      const client = await createClient(keyring);
      fetchMock.mockResolvedValueOnce(
        failure(404, 'No agent key configured for this user', 'Not Found'),
      );

      await expect(client.getDecryptedAgentKey(userId)).rejects.toThrow(
        NotFoundException,
      );
    });

    // nest-mongo-user répond 409 pour une clé encore au format 1.x : son
    // message dit quoi faire, il doit arriver jusqu'à l'appelant.
    it('should pass on the reason of any other refusal', async () => {
      const client = await createClient(keyring);
      const reason =
        'The stored agent key uses the crypto-utils 1.x format { data, iv, tag }: run set-agent-key again';
      fetchMock.mockResolvedValueOnce(failure(409, reason, 'Conflict'));

      await expect(client.getDecryptedAgentKey(userId)).rejects.toThrow(
        new InternalServerErrorException(
          `User service returned 409: ${reason}`,
        ),
      );
    });
  });
});
