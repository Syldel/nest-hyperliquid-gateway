import { encode as encodeMsgpack } from '@msgpack/msgpack';

import { SigningService } from '../../crypto/services/signing.service';
import {
  activationSideRefusal,
  buildTrailingStopAction,
  encodePct,
  readTrailingStopAnswer,
  TrailingStopRequest,
  TrailingStopRequestError,
} from './trailing-stop-action';

/**
 * ============================================================================
 * CE QUI EST SIGNÉ EST CE QUI A ÉTÉ DEMANDÉ, OU RIEN
 *
 * ETH sur le dex principal : asset 1, `szDecimals` 4 (relevé de `meta`), donc
 * des tailles au dix-millième et des prix à cinq chiffres significatifs, deux
 * décimales au plus. Les écritures attendues viennent du client officiel
 * (`app.hyperliquid.xyz`, lu le 2026-11-16) : `toFixed(4) + '%'` pour le
 * pourcentage, décimale sans zéro final ailleurs, `null` explicite pour une
 * activation immédiate.
 *
 * ⚠️ Ces tests prouvent que l'action est écrite comme le client officiel
 * l'écrit. Qu'Hyperliquid accepte NOTRE signature ne se prouve qu'en réel :
 * une signature fausse se lirait « User or API Wallet … does not exist ».
 * ============================================================================
 */

const ETH = { asset: 1, szDecimals: 4 };

const sellStop = (
  overrides: Partial<TrailingStopRequest> = {},
): TrailingStopRequest => ({
  isBuy: false,
  sz: '0.0065',
  reduceOnly: true,
  retracement: { pct: '10' },
  ...overrides,
});

describe('buildTrailingStopAction', () => {
  it('writes the keys in the order the action is hashed', () => {
    const action = buildTrailingStopAction(sellStop(), ETH);

    expect(Object.keys(action)).toEqual([
      'type',
      'asset',
      'isBuy',
      'sz',
      'reduceOnly',
      'retracement',
      'activationPx',
    ]);
  });

  it('writes an immediate percent trailing stop the way the official client does', () => {
    expect(buildTrailingStopAction(sellStop(), ETH)).toEqual({
      type: 'trailingStop',
      asset: 1,
      isBuy: false,
      sz: '0.0065',
      reduceOnly: true,
      retracement: { pct: '10.0000%' },
      activationPx: null,
    });
  });

  // Une clé omise et une clé à `null` ne donnent pas le même msgpack, donc pas
  // la même signature.
  it.each([
    ['absent', undefined],
    ['null', null],
  ])(
    'writes an explicit null when the activation is %s',
    (_label, activationPx) => {
      const action = buildTrailingStopAction(sellStop({ activationPx }), ETH);

      expect('activationPx' in action).toBe(true);
      expect(action.activationPx).toBeNull();
    },
  );

  it('writes a price retracement and an activation price, canonical', () => {
    const action = buildTrailingStopAction(
      sellStop({
        reduceOnly: false,
        retracement: { px: '275.0' },
        activationPx: '2100.00',
      }),
      ETH,
    );

    expect(action.retracement).toEqual({ px: '275' });
    expect(action.activationPx).toBe('2100');
  });

  // Le normaliseur de la signature ne touche pas `sz` : un zéro final partirait
  // tel quel dans le hachage.
  it('writes the size without trailing zeros', () => {
    expect(buildTrailingStopAction(sellStop({ sz: '0.0060' }), ETH).sz).toBe(
      '0.006',
    );
  });

  describe('refuses rather than truncates', () => {
    it('a size off the size grid, naming the nearest size below', () => {
      expect(() =>
        buildTrailingStopAction(sellStop({ sz: '0.00655' }), ETH),
      ).toThrow(
        new TrailingStopRequestError(
          'sz 0.00655 is not on the size grid (4 decimals): the nearest size below is 0.0065',
        ),
      );
    });

    it('a size that the grid reduces to zero', () => {
      expect(() =>
        buildTrailingStopAction(sellStop({ sz: '0.00001' }), ETH),
      ).toThrow(TrailingStopRequestError);
    });

    // Cinq chiffres significatifs : 2100,5 est sur la grille, 2100,55 non.
    it('an activation price off the price grid', () => {
      expect(() =>
        buildTrailingStopAction(sellStop({ activationPx: '2100.55' }), ETH),
      ).toThrow(
        'activationPx 2100.55 is not on the price grid: the nearest price below is 2100.5',
      );
    });

    it('a price retracement off the price grid', () => {
      expect(() =>
        buildTrailingStopAction(
          sellStop({ retracement: { px: '27.555' } }),
          ETH,
        ),
      ).toThrow(TrailingStopRequestError);
    });

    it('a percent with more decimals than the official writing keeps', () => {
      expect(() =>
        buildTrailingStopAction(
          sellStop({ retracement: { pct: '1.23456' } }),
          ETH,
        ),
      ).toThrow('retracement.pct 1.23456 has more than 4 decimals');
    });
  });

  describe('refuses a request that says nothing or two things', () => {
    it.each([
      ['neither pct nor px', {}],
      ['both pct and px', { pct: '10', px: '275' }],
    ])('a retracement with %s', (_label, retracement) => {
      expect(() =>
        buildTrailingStopAction(sellStop({ retracement }), ETH),
      ).toThrow('retracement must carry exactly one of pct or px');
    });

    it.each([
      ['a zero size', { sz: '0' }],
      ['a zero percent', { retracement: { pct: '0.0' } }],
      ['a zero price distance', { retracement: { px: '0' } }],
      ['a zero activation', { activationPx: '0' }],
      ['a negative size', { sz: '-0.0065' }],
      ['an exponent', { activationPx: '2.1e3' }],
      ['a comma', { sz: '0,0065' }],
    ])('%s', (_label, overrides) => {
      expect(() => buildTrailingStopAction(sellStop(overrides), ETH)).toThrow(
        TrailingStopRequestError,
      );
    });
  });

  // `actionHash` ne réécrit que `p` et `s`. Ce test tombe le jour où le
  // normaliseur toucherait une clé du trailing stop : l'action envoyée et
  // l'action hachée divergeraient, et la signature serait refusée.
  it('is hashed exactly as it is sent', () => {
    const action = buildTrailingStopAction(
      sellStop({ retracement: { px: '275' }, activationPx: '2100' }),
      ETH,
    );
    const hashed = new SigningService().normalizeTrailingZeros(action);

    expect(encodeMsgpack(hashed)).toEqual(encodeMsgpack(action));
  });
});

describe('activationSideRefusal', () => {
  it.each([
    ['a sell above the mark', false, '2355'],
    ['a buy below the mark', true, '1700'],
  ])('accepts %s', (_label, isBuy, activationPx) => {
    expect(activationSideRefusal(isBuy, activationPx, '1809.9')).toBeNull();
  });

  it.each([
    ['a sell below the mark (measured: tracked at once)', false, '1719.4'],
    ['a buy above the mark', true, '1900'],
    ['a sell at the mark', false, '1809.9'],
    ['a buy at the mark', true, '1809.9'],
  ])('refuses %s', (_label, isBuy, activationPx) => {
    expect(activationSideRefusal(isBuy, activationPx, '1809.9')).toContain(
      'tracking would start at once',
    );
  });

  it('refuses when the mark cannot be read', () => {
    expect(activationSideRefusal(false, '2355', '')).toContain(
      'cannot be checked',
    );
  });
});

describe('encodePct', () => {
  it.each([
    ['10', '10.0000%'],
    ['1.5', '1.5000%'],
    ['0.05', '0.0500%'],
    ['1.2345', '1.2345%'],
    ['010', '10.0000%'],
  ])('writes %s as %s', (pct, expected) => {
    expect(encodePct(pct)).toBe(expected);
  });
});

describe('readTrailingStopAnswer', () => {
  it('reads the documented success as a placed order with its oid', () => {
    expect(
      readTrailingStopAnswer({
        status: 'ok',
        response: { type: 'trailingStop', data: { oid: 77738308 } },
      }),
    ).toEqual({ kind: 'placed', oid: 77738308 });
  });

  it('reads a refusal of the whole action with its text', () => {
    expect(
      readTrailingStopAnswer({
        status: 'err',
        response: 'Trailing stops are not supported for this asset.',
      }),
    ).toEqual({
      kind: 'refused',
      message: 'Trailing stops are not supported for this asset.',
    });
  });

  // Chacune de ces formes a pu poser un ordre, ou non : seule une relecture
  // des ordres ouverts le dira. Aucune ne doit passer pour un succès ni pour
  // un refus.
  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a refusal without text', { status: 'err', response: { code: 1 } }],
    [
      'the generic acknowledgement',
      { status: 'ok', response: { type: 'default' } },
    ],
    [
      'the shape of an ordinary order',
      {
        status: 'ok',
        response: {
          type: 'order',
          data: { statuses: [{ resting: { oid: 1 } }] },
        },
      },
    ],
    [
      'statuses under the trailing stop type',
      {
        status: 'ok',
        response: {
          type: 'trailingStop',
          data: { statuses: [{ error: 'x' }] },
        },
      },
    ],
    [
      'an oid written as text',
      {
        status: 'ok',
        response: { type: 'trailingStop', data: { oid: '77738308' } },
      },
    ],
    [
      'a zero oid',
      { status: 'ok', response: { type: 'trailingStop', data: { oid: 0 } } },
    ],
    ['an unknown status', { status: 'pending' }],
  ])('reads %s as an unknown outcome', (_label, reply) => {
    expect(readTrailingStopAnswer(reply)).toEqual({ kind: 'unknown' });
  });
});
