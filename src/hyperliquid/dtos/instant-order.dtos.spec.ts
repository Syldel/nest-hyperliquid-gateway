import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InstantOrderDto } from './instant-order.dtos';

/** Les mêmes options que le ValidationPipe global de `main.ts`. */
const PIPE = { whitelist: true, forbidNonWhitelisted: true } as const;

/** Le corps que le bot envoie (`hl-execution.service.ts`) : ni `maxRetries`, ni `delayMs`. */
const body = {
  assetName: 'BTC',
  isBuy: true,
  size: { type: 'base', sz: '0.00019' },
  tif: 'Alo',
  reduceOnly: false,
  isTestnet: false,
};

const errorsOf = async (plain: Record<string, unknown>) =>
  JSON.stringify(await validate(plainToInstance(InstantOrderDto, plain), PIPE));

/**
 * Les relances d'un ordre instantané se bornent avant d'atteindre le service : sans borne, un client pouvait faire
 * partir des dizaines d'ordres d'un coup, que le garde de débit ne freine pas (voir `INSTANT_ORDER_LIMITS`).
 */
describe('the instant order DTO', () => {
  it('accepts the body the bot sends, with no retry settings', async () => {
    expect(await errorsOf(body)).toBe('[]');
  });

  it('accepts retry settings inside the bounds', async () => {
    for (const settings of [
      { maxRetries: 1, delayMs: 1_000 },
      { maxRetries: 6, delayMs: 15_000 },
      { maxRetries: 3, delayMs: 7_500 },
    ]) {
      expect(await errorsOf({ ...body, ...settings })).toBe('[]');
    }
  });

  it.each([7, 1_000_000, 0, -1, 2.5])(
    'refuses %p retries',
    async (maxRetries) => {
      expect(await errorsOf({ ...body, maxRetries })).toContain('maxRetries');
    },
  );

  // Moins d'une seconde : six tentatives dans la même seconde. Plus de 15 s : le pire cas dépasse le délai d'écriture
  // du bot, qui déclarerait l'ordre en état inconnu.
  it.each([0, 999, 15_001, 60_000, 7_500.5])(
    'refuses a delay of %p ms',
    async (delayMs) => {
      expect(await errorsOf({ ...body, delayMs })).toContain('delayMs');
    },
  );

  // `null` n'est pas « absent » : la valeur par défaut du service ne le remplacerait pas.
  it('refuses retry settings that are not numbers, null included', async () => {
    expect(await errorsOf({ ...body, maxRetries: null })).toContain(
      'maxRetries',
    );
    expect(await errorsOf({ ...body, maxRetries: '6' })).toContain(
      'maxRetries',
    );
    expect(await errorsOf({ ...body, delayMs: null })).toContain('delayMs');
  });
});
