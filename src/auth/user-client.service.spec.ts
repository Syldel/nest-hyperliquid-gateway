import { Test, TestingModule } from '@nestjs/testing';
import {
  InternalServerErrorException,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { JweUtil } from '@syldel/crypto-utils';
import { randomBytes } from 'crypto';
import { UserClient } from './user-client.service';
import { agentKeyContext } from './agent-key';

/**
 * Le chiffrement est réel : les clés sont scellées comme set-agent-key les
 * scelle (nest-mongo-user), et seul `fetch` est remplacé. Les réponses
 * reprennent celles de nest-mongo-user : `{ agentKey, agent }` en 200 (`agent`
 * sérialisé par JSON, dates en ISO 8601, ou `null`), et le corps d'erreur
 * standard de Nest (`statusCode`, `message`, `error`) sinon.
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

  // Tel que nest-mongo-user le sérialise : `Date` → chaîne ISO.
  const agent = {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    name: 'bot_main',
    validUntil: '2027-05-04T11:00:28.000Z',
    keyUpdatedAt: '2026-11-05T11:05:00.000Z',
  };
  const credentials = (agentKey: string, agentData: unknown = agent) => ({
    agentKey,
    agent: agentData,
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

  describe('getAgentCredentials', () => {
    const keyring = `2026-11:${masterKey.toString('hex')}`;

    it('should fetch the sealed key and open it for this user', async () => {
      const client = await createClient(keyring);
      fetchMock.mockResolvedValueOnce(ok(credentials(sealFor(userId))));

      await expect(
        client.getAgentCredentials(userId).then((c) => c.privateKey),
      ).resolves.toBe(agentPrivateKey);
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
        ok(credentials(sealFor(userId, '2025-02', older))),
      );

      await expect(
        client.getAgentCredentials(userId).then((c) => c.privateKey),
      ).resolves.toBe(agentPrivateKey);
    });

    it('should serve the second call from the cache, which never holds the key in clear', async () => {
      const client = await createClient(keyring);
      fetchMock.mockResolvedValueOnce(ok(credentials(sealFor(userId))));

      await client.getAgentCredentials(userId);
      await expect(
        client.getAgentCredentials(userId).then((c) => c.privateKey),
      ).resolves.toBe(agentPrivateKey);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const cache = (
        client as unknown as { keyCache: Map<string, { sealed: string }> }
      ).keyCache;
      expect(JSON.stringify([...cache.values()])).not.toContain(
        agentPrivateKey.slice(2),
      );
    });

    it('should fetch again after the cache expires (7 days)', async () => {
      const client = await createClient(keyring);
      fetchMock.mockResolvedValue(ok(credentials(sealFor(userId))));

      await client.getAgentCredentials(userId);
      jest.advanceTimersByTime(7 * 24 * 60 * 60 * 1000 + 1);
      await client.getAgentCredentials(userId);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    // Le cas que le contexte existe pour arrêter : une clé recopiée en base
    // d'un utilisateur sur un autre.
    it('should refuse a key sealed for another user, and say so', async () => {
      const client = await createClient(keyring);
      fetchMock.mockResolvedValueOnce(
        ok(credentials(sealFor('another-user-id'))),
      );

      await expect(client.getAgentCredentials(userId)).rejects.toThrow(
        new InternalServerErrorException(
          `Agent key could not be opened: Context mismatch: sealed for "hl-agent-key:another-user-id", expected "hl-agent-key:${userId}"`,
        ),
      );
    });

    it('should name a kid missing from the keyring', async () => {
      const client = await createClient(keyring);
      fetchMock.mockResolvedValueOnce(
        ok(credentials(sealFor(userId, '2027-01', randomBytes(32)))),
      );

      await expect(client.getAgentCredentials(userId)).rejects.toThrow(
        'Agent key could not be opened: Unknown key id: "2027-01"',
      );
    });

    it('should refuse an answer without an agent key string', async () => {
      const client = await createClient(keyring);
      fetchMock.mockResolvedValueOnce(ok({ data: 'aa', iv: 'bb', tag: 'cc' }));

      await expect(client.getAgentCredentials(userId)).rejects.toThrow(
        'User service answered without an agent key string',
      );
    });

    it('should throw NotFoundException when the user service answers 404', async () => {
      const client = await createClient(keyring);
      fetchMock.mockResolvedValueOnce(
        failure(404, 'No agent key configured for this user', 'Not Found'),
      );

      await expect(client.getAgentCredentials(userId)).rejects.toThrow(
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

      await expect(client.getAgentCredentials(userId)).rejects.toThrow(
        new InternalServerErrorException(
          `User service returned 409: ${reason}`,
        ),
      );
    });
  });

  describe('agent data', () => {
    const keyring = `2026-11:${masterKey.toString('hex')}`;

    it('should return the declared agent with its dates read back', async () => {
      const client = await createClient(keyring);
      fetchMock.mockResolvedValueOnce(ok(credentials(sealFor(userId))));

      const { agent: read } = await client.getAgentCredentials(userId);
      expect(read).toEqual({
        address: agent.address,
        name: 'bot_main',
        validUntil: new Date('2027-05-04T11:00:28.000Z'),
        keyUpdatedAt: new Date('2026-11-05T11:05:00.000Z'),
      });
    });

    // Une clé enregistrée avant qu'on demande son expiration : refusée en le
    // nommant, et sans même être ouverte.
    it('should refuse a key stored without agent data, without opening it', async () => {
      const client = await createClient(keyring);
      const open = jest.spyOn(JweUtil, 'open');
      fetchMock.mockResolvedValueOnce(ok(credentials(sealFor(userId), null)));

      await expect(client.getAgentCredentials(userId)).rejects.toThrow(
        new PreconditionFailedException(
          'The agent key has no declared expiry or address: run set-agent-key again',
        ),
      );
      expect(open).not.toHaveBeenCalled();
    });

    // `agent` absent de la réponse n'est pas `null` : un nest-mongo-user plus
    // ancien que ce gateway. Jamais lu comme « pas d'expiration ».
    it.each([
      ['missing', { agentKey: 'x' }],
      ['a string', credentials('x', 'soon')],
      [
        'without validUntil',
        credentials('x', { ...agent, validUntil: undefined }),
      ],
      [
        'with an unreadable date',
        credentials('x', { ...agent, validUntil: 'soon' }),
      ],
      ['with a short address', credentials('x', { ...agent, address: '0x12' })],
      ['with an empty name', credentials('x', { ...agent, name: '' })],
    ])('should refuse agent data %s as malformed', async (_label, body) => {
      const client = await createClient(keyring);
      fetchMock.mockResolvedValueOnce(ok(body));

      await expect(client.getAgentCredentials(userId)).rejects.toThrow(
        new InternalServerErrorException(
          'User service answered malformed agent data',
        ),
      );
    });
  });

  describe('refreshExistingCache', () => {
    const keyring = `2026-11:${masterKey.toString('hex')}`;

    // Une clé retirée ou remplacée en base ne doit plus signer : un
    // rafraîchissement refusé vide l'entrée au lieu de garder l'ancienne.
    it('should drop a cached key whose refresh is refused', async () => {
      const client = await createClient(keyring);
      fetchMock.mockResolvedValueOnce(ok(credentials(sealFor(userId))));
      await client.getAgentCredentials(userId);

      fetchMock.mockResolvedValueOnce(ok(credentials(sealFor(userId), null)));
      await client.refreshExistingCache();

      fetchMock.mockResolvedValueOnce(ok(credentials(sealFor(userId), null)));
      await expect(client.getAgentCredentials(userId)).rejects.toThrow(
        PreconditionFailedException,
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should replace a cached key with the refreshed one', async () => {
      const client = await createClient(keyring);
      fetchMock.mockResolvedValueOnce(ok(credentials(sealFor(userId))));
      await client.getAgentCredentials(userId);

      const renamed = { ...agent, name: 'bot_next' };
      fetchMock.mockResolvedValueOnce(
        ok(credentials(sealFor(userId), renamed)),
      );
      await client.refreshExistingCache();

      const { agent: read } = await client.getAgentCredentials(userId);
      expect(read.name).toBe('bot_next');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
