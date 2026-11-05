import { agentRefusal, readAgentInfo } from './agent-key';

describe('readAgentInfo', () => {
  const raw = {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    name: 'bot_main',
    validUntil: '2027-05-04T11:00:28.000Z',
    keyUpdatedAt: '2026-11-05T11:05:00.000Z',
  };

  it('should read the dates nest-mongo-user serialises as ISO strings', () => {
    expect(readAgentInfo(raw)).toEqual({
      ...raw,
      validUntil: new Date(raw.validUntil),
      keyUpdatedAt: new Date(raw.keyUpdatedAt),
    });
  });

  it('should read null as no declared data', () => {
    expect(readAgentInfo(null)).toBeNull();
  });

  it.each([
    ['undefined', undefined],
    ['a number', 42],
    ['an empty object', {}],
    ['a numeric date', { ...raw, validUntil: 1809342028000 }],
  ])('should refuse %s', (_label, value) => {
    expect(() => readAgentInfo(value)).toThrow(
      'User service answered malformed agent data',
    );
  });
});

describe('agentRefusal', () => {
  const agent = {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    name: 'bot_main',
    validUntil: new Date('2027-05-04T11:00:28.000Z'),
    keyUpdatedAt: new Date('2026-11-05T11:05:00.000Z'),
  };
  const before = Date.parse('2027-05-04T11:00:27.999Z');
  const master = '0x1111111111111111111111111111111111111111';

  it('should let a matching, unexpired agent sign', () => {
    expect(agentRefusal(agent, agent.address, master, before)).toBeNull();
  });

  // ethers rend l'adresse en EIP-55 ; la base peut l'avoir dans une autre casse.
  it('should compare addresses regardless of case', () => {
    expect(
      agentRefusal(agent, agent.address.toLowerCase(), master, before),
    ).toBeNull();
  });

  // À l'instant même de l'expiration, Hyperliquid ne l'accepte plus.
  it('should refuse from the expiry instant on, naming the agent and the date', () => {
    expect(
      agentRefusal(agent, agent.address, master, agent.validUntil.getTime()),
    ).toBe(
      'The agent "bot_main" (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266) expired on 2027-05-04T11:00:28.000Z: authorize a new API wallet on Hyperliquid, then run set-agent-key',
    );
  });

  it('should refuse a key that is not the declared agent', () => {
    expect(
      agentRefusal(
        agent,
        '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
        master,
        before,
      ),
    ).toBe(
      'The agent key belongs to 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf, not to the declared agent 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 ("bot_main"): run set-agent-key again',
    );
  });

  // Le contrôle d'adresse passe avant l'expiration : une clé étrangère est le
  // problème à nommer, quelle que soit la date.
  it('should name the address mismatch first, even once expired', () => {
    expect(
      agentRefusal(
        agent,
        '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
        master,
        agent.validUntil.getTime() + 1,
      ),
    ).toMatch(/^The agent key belongs to/);
  });

  // La clé du wallet maître ne signe jamais, même déclarée comme agent et
  // valide : elle a des pouvoirs qu'un agent n'a pas.
  it('should refuse the master wallet key, whatever the case and the declared data', () => {
    expect(
      agentRefusal(agent, agent.address, agent.address.toLowerCase(), before),
    ).toBe(
      'The stored agent key is the master wallet 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 itself, not an API wallet: run set-agent-key with an API wallet key',
    );
  });

  // Fermé par défaut : sans wallet connecté, rien à comparer, rien de signé.
  it.each([undefined, ''])(
    'should refuse without a signed-in wallet (%p)',
    (wallet) => {
      expect(agentRefusal(agent, agent.address, wallet, before)).toBe(
        'No signed-in wallet to check the agent key against: nothing signed',
      );
    },
  );
});
