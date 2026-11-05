import { Logger, PreconditionFailedException } from '@nestjs/common';
import { HyperliquidApiTradeService } from './hyperliquid-api-trade.service';
import { HyperliquidRateGuardService } from './hyperliquid-rate-guard.service';
import { WalletService } from '../../crypto/services/wallet.service';
import type { AgentInfo } from '../../auth/agent-key';

/**
 * L'agent qui signe, contrôlé dans `executeWithNonce` : le seul passage de
 * toute action `/exchange`. La clé est réelle (le compte #0 de Hardhat, clé
 * publiée) et l'adresse vient d'ethers, comme en production ; seuls `fetch`,
 * le nonce et la signature sont remplacés.
 */
const PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const OTHER_ADDRESS = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe('HyperliquidApiTradeService — the signing agent', () => {
  let fetchMock: jest.Mock;
  let warn: jest.SpyInstance<void, [message: unknown, ...rest: unknown[]]>;
  let getTimestamp: jest.Mock;
  let signL1Action: jest.Mock;

  beforeEach(() => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    getTimestamp = jest.fn().mockReturnValue(1);
    signL1Action = jest.fn().mockResolvedValue({ r: '0x1', s: '0x2', v: 27 });
  });

  afterEach(() => jest.restoreAllMocks());

  function serviceWith(agent: Partial<AgentInfo>) {
    const declared: AgentInfo = {
      address: ADDRESS,
      name: 'bot_main',
      validUntil: new Date(Date.now() + 86_400_000),
      keyUpdatedAt: new Date(),
      ...agent,
    };
    return new HyperliquidApiTradeService(
      { userId: 'u-1' } as never,
      {
        getAgentCredentials: jest
          .fn()
          .mockResolvedValue({ privateKey: PRIVATE_KEY, agent: declared }),
      } as never,
      { getTimestamp } as never,
      {} as never,
      {} as never,
      { signL1Action } as never,
      new WalletService(),
      new HyperliquidRateGuardService(),
    );
  }

  /** `executeWithNonce` est privée : on l'atteint sans passer par `any`. */
  type WithNonce = {
    executeWithNonce: (endpoint: string, action: object) => Promise<unknown>;
  };
  const send = (service: HyperliquidApiTradeService) =>
    (service as unknown as WithNonce).executeWithNonce('exchange', {
      type: 'order',
      orders: [{}],
    });

  it('should sign and send for a matching, unexpired agent', async () => {
    fetchMock.mockResolvedValueOnce(response(200, { status: 'ok' }));

    await expect(send(serviceWith({}))).resolves.toEqual({ status: 'ok' });
    expect(signL1Action).toHaveBeenCalledTimes(1);
  });

  // Le refus se fait avant le nonce, la signature et le réseau : rien ne part.
  it('should refuse an expired agent before any nonce, signature or request', async () => {
    const error = await send(
      serviceWith({ validUntil: new Date(Date.now() - 1) }),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PreconditionFailedException);
    expect((error as Error).message).toMatch(
      /^The agent "bot_main" \(0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266\) expired on /,
    );
    expect(getTimestamp).not.toHaveBeenCalled();
    expect(signL1Action).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should refuse a key that is not the declared agent', async () => {
    const error = await send(serviceWith({ address: OTHER_ADDRESS })).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(PreconditionFailedException);
    expect((error as Error).message).toMatch(
      /^The agent key belongs to 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266, not to the declared agent/,
    );
    expect(signL1Action).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should log a refused signing with its reason, never the key', async () => {
    await send(serviceWith({ validUntil: new Date(Date.now() - 1) })).catch(
      () => undefined,
    );

    const lines = warn.mock.calls.map((call) => String(call[0]));
    expect(lines).toEqual([
      expect.stringMatching(/^Exchange order not signed: The agent "bot_main"/),
    ]);
    expect(lines.join()).not.toContain(PRIVATE_KEY.slice(2));
  });

  // Le refus mesuré le 2026-10-29 : HTTP 200, `status: "err"`, et rien dans
  // le journal. Il s'écrit désormais avec l'agent qui a signé.
  it('should log an exchange refusal with the signing agent, never the request', async () => {
    const refusal =
      'User or API Wallet 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 does not exist.';
    fetchMock.mockResolvedValueOnce(
      response(200, { status: 'err', response: refusal }),
    );

    await expect(send(serviceWith({}))).resolves.toEqual({
      status: 'err',
      response: refusal,
    });

    const lines = warn.mock.calls.map((call) => String(call[0]));
    expect(lines).toEqual([
      `Exchange refused order signed by agent ${ADDRESS} ("bot_main"): ${refusal}`,
    ]);
    expect(lines.join()).not.toContain(PRIVATE_KEY.slice(2));
    expect(lines.join()).not.toContain('nonce');
  });

  it('should bound a long refusal text in the log', async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, { status: 'err', response: 'x'.repeat(1000) }),
    );

    await send(serviceWith({}));

    const line = String(warn.mock.calls[0][0]);
    expect(line.endsWith('x'.repeat(300) + '…')).toBe(true);
    expect(line).not.toContain('x'.repeat(301));
  });

  it('should not log an accepted action', async () => {
    fetchMock.mockResolvedValueOnce(response(200, { status: 'ok' }));

    await send(serviceWith({}));

    expect(warn).not.toHaveBeenCalled();
  });
});
