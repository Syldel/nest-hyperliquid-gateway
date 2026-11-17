import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { TrailingStopDto } from './trailing-stop.dtos';

/** Les mêmes options que le ValidationPipe global de `main.ts`. */
const PIPE = { whitelist: true, forbidNonWhitelisted: true } as const;

const body = {
  assetName: 'ETH',
  isBuy: false,
  sz: '0.0065',
  reduceOnly: true,
  retracement: { pct: '10' },
};

const errorsOf = async (plain: Record<string, unknown>) =>
  JSON.stringify(await validate(plainToInstance(TrailingStopDto, plain), PIPE));

describe('the trailing stop DTO', () => {
  it('accepts an immediate percent trailing stop', async () => {
    expect(await errorsOf(body)).toBe('[]');
  });

  it('accepts a price retracement with an activation price', async () => {
    expect(
      await errorsOf({
        ...body,
        reduceOnly: false,
        retracement: { px: '275' },
        activationPx: '2100',
      }),
    ).toBe('[]');
  });

  // Fermer une position et en ouvrir une sont deux intentions : rien ne se
  // déduit par défaut.
  it('refuses a body that does not say whether it reduces only', async () => {
    expect(await errorsOf({ ...body, reduceOnly: undefined })).toContain(
      'reduceOnly',
    );
  });

  it('refuses a body without a retracement', async () => {
    expect(await errorsOf({ ...body, retracement: undefined })).toContain(
      'retracement',
    );
  });

  // L'action n'a pas de cloid : en accepter un ferait croire qu'il sert à
  // retrouver l'ordre.
  it('refuses a cloid', async () => {
    expect(await errorsOf({ ...body, cloid: '0x01' })).toContain(
      'cloid should not exist',
    );
  });

  it('refuses an unknown key inside the retracement', async () => {
    expect(
      await errorsOf({ ...body, retracement: { pct: '10', unit: '%' } }),
    ).toContain('unit should not exist');
  });

  it.each([
    ['a negative size', { sz: '-0.0065' }],
    ['an exponent', { sz: '6.5e-3' }],
    ['a size as a number', { sz: 0.0065 }],
    ['a percent with its sign', { retracement: { pct: '10%' } }],
    ['an activation as a number', { activationPx: 2100 }],
  ])('refuses %s', async (_label, overrides) => {
    expect(await errorsOf({ ...body, ...overrides })).not.toBe('[]');
  });
});
