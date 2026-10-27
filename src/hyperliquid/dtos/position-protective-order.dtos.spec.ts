import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ModifyPositionProtectiveOrderDto,
  PositionProtectiveOrderDto,
} from './position-protective-order.dtos';

/** Les mêmes options que le ValidationPipe global de `main.ts`. */
const PIPE = { whitelist: true, forbidNonWhitelisted: true } as const;

const body = {
  assetName: 'ETH',
  kind: 'sl',
  isBuy: false,
  price: '2307.2',
};

const errorsOf = async (plain: Record<string, unknown>) =>
  validate(plainToInstance(PositionProtectiveOrderDto, plain), PIPE);

describe('the position-level order DTO', () => {
  it('accepts a stop with no size', async () => {
    expect(await errorsOf(body)).toEqual([]);
  });

  it('accepts the booleans the way the other protective routes read them', async () => {
    expect(
      await errorsOf({ ...body, isBuy: 'true', isTestnet: 'false' }),
    ).toEqual([]);
  });

  // C'est le point de la famille : un corps qui porte une taille n'est pas une variante, c'est une erreur.
  it('refuses a size, whatever it is, before anything is signed', async () => {
    for (const sz of ['0.006', '0', 0.006]) {
      const errors = await errorsOf({ ...body, sz });

      expect(JSON.stringify(errors)).toContain('sz should not exist');
    }
  });

  it('refuses a choice between market and limit: only the market form was seen', async () => {
    const errors = await errorsOf({ ...body, isMarket: false });

    expect(JSON.stringify(errors)).toContain('isMarket should not exist');
  });

  it('refuses a kind that is neither "tp" nor "sl"', async () => {
    const errors = await errorsOf({ ...body, kind: 'stop' });

    expect(errors[0].property).toBe('kind');
    expect(Object.values(errors[0].constraints ?? {})).toContain(
      'kind must be either "tp" or "sl"',
    );
  });

  it('refuses a trigger price that is not a number', async () => {
    expect(await errorsOf({ ...body, price: 'abc' })).not.toEqual([]);
    expect(await errorsOf({ ...body, price: undefined })).not.toEqual([]);
  });

  it('asks for an oid on a modification, and only there', async () => {
    const modify = (plain: Record<string, unknown>) =>
      validate(plainToInstance(ModifyPositionProtectiveOrderDto, plain), PIPE);

    expect(await modify({ ...body, oid: 586699627884 })).toEqual([]);
    expect(JSON.stringify(await modify(body))).toContain('oid');
    expect(JSON.stringify(await errorsOf({ ...body, oid: 1 }))).toContain(
      'oid should not exist',
    );
  });
});
