import { Logger, UnauthorizedException } from '@nestjs/common';
import { PureJwtUtil } from '@syldel/crypto-utils';
import { InternalSyncController } from './internal-sync.controller';
import { UserClient } from './user-client.service';

const SECRET = 'd4'.repeat(32);
const now = () => Math.floor(Date.now() / 1000);

/** Le jeton que nest-mongo-user envoie avec son webhook (WebhookService). */
const webhookToken = (claims: Record<string, unknown> = {}) =>
  PureJwtUtil.sign(
    { sub: 'nest-mongo-user', iat: now(), exp: now() + 60, ...claims },
    SECRET,
  );

function controller(
  refreshExistingCache = jest.fn().mockResolvedValue(undefined),
) {
  const c = new InternalSyncController({
    refreshExistingCache,
  } as unknown as UserClient);
  c.onModuleInit();
  return { controller: c, refreshExistingCache };
}

describe('InternalSyncController', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, JWT_SERVICE_SECRET: SECRET };
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it.each([
    ['missing', undefined],
    ['not 64 hex characters', 'super-secret-service'],
  ])('should refuse to start with a %s secret', (_label, secret) => {
    if (secret === undefined) delete process.env.JWT_SERVICE_SECRET;
    else process.env.JWT_SERVICE_SECRET = secret;
    const c = new InternalSyncController({} as UserClient);
    expect(() => c.onModuleInit()).toThrow(
      'JWT_SERVICE_SECRET must be 64 hex characters',
    );
  });

  it('should refresh the cache on the webhook of nest-mongo-user', async () => {
    const { controller: c, refreshExistingCache } = controller();
    await expect(c.triggerSync(`Bearer ${webhookToken()}`)).resolves.toEqual({
      success: true,
    });
    expect(refreshExistingCache).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no Authorization header', undefined],
    ['a token without expiry', `Bearer ${webhookToken({ exp: undefined })}`],
    [
      "another service's token",
      `Bearer ${webhookToken({ sub: 'nest-trading-bot', scope: ['users:read'] })}`,
    ],
    [
      'a token from the future',
      `Bearer ${webhookToken({ iat: now() + 3600 })}`,
    ],
    ['an expired token', `Bearer ${webhookToken({ exp: now() - 1 })}`],
  ])('should refuse %s, without refreshing', async (_label, header) => {
    const { controller: c, refreshExistingCache } = controller();
    await expect(c.triggerSync(header as string)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(refreshExistingCache).not.toHaveBeenCalled();
  });

  it('should let a refresh failure through as itself, not as a refused token', async () => {
    const failure = new Error('user service unreachable');
    const { controller: c } = controller(jest.fn().mockRejectedValue(failure));
    await expect(c.triggerSync(`Bearer ${webhookToken()}`)).rejects.toBe(
      failure,
    );
  });
});
