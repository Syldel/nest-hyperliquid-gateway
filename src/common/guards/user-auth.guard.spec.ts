import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { PureJwtUtil } from '@syldel/crypto-utils';
import { UserContextService } from '../../auth/user-context.service';
import { UserAuthGuard } from './user-auth.guard';
import { JwtSecrets } from '../../auth/jwt-secret';

const SECRET = 'a1'.repeat(32);
const now = () => Math.floor(Date.now() / 1000);

/** Un jeton comme ceux de nest-mongo-user : sub, wallet, username, iat et exp. */
const userToken = (claims: Record<string, unknown> = {}, secret = SECRET) =>
  PureJwtUtil.sign(
    {
      sub: 'user-1',
      wallet: '0x' + 'ab'.repeat(20),
      username: 'alice',
      iat: now(),
      exp: now() + 3600,
      ...claims,
    },
    secret,
  );

function context(authorization?: string) {
  const request: Record<string, unknown> = {
    headers: authorization ? { authorization } : {},
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

function guard() {
  const userContext = { setUser: jest.fn() };
  const secrets = new JwtSecrets();
  secrets.onModuleInit();
  const g = new UserAuthGuard(
    userContext as unknown as UserContextService,
    secrets,
  );
  return { guard: g, userContext };
}

describe('UserAuthGuard', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      JWT_USER_SECRET: SECRET,
      JWT_SERVICE_SECRET: 'b2'.repeat(32),
    };
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  // Absent, chaque requête répondait « User token missing » : le client était
  // accusé d'une erreur de configuration du serveur.
  it.each([
    ['JWT_USER_SECRET', 'missing', undefined],
    ['JWT_USER_SECRET', 'not 64 hex characters', 'super-secret-user'],
    ['JWT_SERVICE_SECRET', 'missing', undefined],
  ])('should refuse to start with %s %s', (name, _label, value) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    expect(() => new JwtSecrets().onModuleInit()).toThrow(
      `${name} must be 64 hex characters`,
    );
  });

  // Une garde créée sans que JwtSecrets ait démarré : erreur de câblage,
  // jamais un 401 qui accuserait le jeton.
  it('should fail loudly, not answer 401, if the secrets were never loaded', () => {
    const g = new UserAuthGuard(
      { setUser: jest.fn() } as unknown as UserContextService,
      new JwtSecrets(),
    );
    expect(() => g.canActivate(context(`Bearer ${userToken()}`).ctx)).toThrow(
      'JWT_USER_SECRET read before JwtSecrets was initialised',
    );
  });

  it('should put the token holder on the request and in the user context', () => {
    const { guard: g, userContext } = guard();
    const { ctx, request } = context(`Bearer ${userToken()}`);

    expect(g.canActivate(ctx)).toBe(true);
    expect(request.user).toEqual({
      id: 'user-1',
      wallet: '0x' + 'ab'.repeat(20),
      username: 'alice',
    });
    expect(userContext.setUser).toHaveBeenCalledWith(request.user);
  });

  it.each([
    ['no token', undefined],
    ['a token without expiry', `Bearer ${userToken({ exp: undefined })}`],
    ['an expired token', `Bearer ${userToken({ exp: now() - 1 })}`],
    [
      'a token signed with another secret',
      `Bearer ${userToken({}, 'b2'.repeat(32))}`,
    ],
  ])('should refuse %s', (_label, header) => {
    const { guard: g, userContext } = guard();
    expect(() => g.canActivate(context(header).ctx)).toThrow(
      UnauthorizedException,
    );
    expect(userContext.setUser).not.toHaveBeenCalled();
  });
});
