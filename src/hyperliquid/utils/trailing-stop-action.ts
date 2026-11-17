import {
  formatPrice,
  formatSize,
  TickAndLotError,
  type DecimalString,
  type HLTrailingRetracement,
  type HLTrailingStopAction,
} from '@syldel/hl-shared-types';

/**
 * ============================================================================
 * LE TRAILING STOP NATIF : CE QUI PART VERS L'EXCHANGE, ÉCRIT À UN SEUL ENDROIT
 *
 * L'action `trailingStop` (ajoutée par Hyperliquid le 2026-09-21) est signée
 * telle qu'elle est écrite ici. Deux contraintes qui ne se voient pas dans son
 * type :
 *
 * - **l'ordre des clés** est celui du hachage msgpack : `type, asset, isBuy,
 *   sz, reduceOnly, retracement, activationPx`, comme la doc et le client
 *   officiel (`app.hyperliquid.xyz`, lu le 2026-11-16) ;
 * - **les valeurs partent déjà canoniques.** `SigningService.actionHash` ne
 *   retire les zéros finaux que des clés `p` et `s` des ordres ordinaires, et
 *   `executeWithNonce` envoie l'action d'origine : un `sz` écrit `"0.0060"`
 *   serait haché et envoyé tel quel. On n'étend pas ce normaliseur global —
 *   il signe tous les autres ordres — : on écrit juste ici.
 *
 * **Une valeur hors grille est refusée, jamais tronquée.** Un stop suiveur dont
 * la taille ou la distance auraient été rabotées en silence n'est plus celui
 * que l'utilisateur a demandé, et rien ne le lui dirait ; l'écran qui envoie
 * doit poser des valeurs déjà sur la grille et recevoir un 400 sinon. La grille
 * est celle du paquet partagé (`formatSize`, `formatPrice`), la même que le bot
 * et le mobile appliquent.
 *
 * Le pourcentage s'écrit comme le client officiel : **quatre décimales et un
 * `%`** (`"10.0000%"`), la seule forme connue pour être acceptée. La doc donne
 * `"1.234%"` en exemple ; rien ne dit si l'exchange normalise ce texte avant
 * de hacher, donc on ne prend pas le pari. Au plus quatre décimales en entrée :
 * une cinquième serait tronquée par cette écriture.
 *
 * **Le sens de l'activation n'est pas contrôlé par l'exchange.** Mesuré le
 * 2026-11-17 : une vente dont l'activation est SOUS le marqué est acceptée
 * et suit tout de suite, sans rien dire. `buildTrailingStopAction` n'a pas le
 * marqué ; `activationSideRefusal` fait le contrôle, appelé par le service
 * avec le marqué qu'il lit. Voir `docs/trailing-stop.md`.
 *
 * ⚠️ Non mesurés : qu'une distance en prix (`retracement.px`) doive tomber
 * sur la grille de prix — elle n'est pas un prix, mais la tenir sur la grille
 * évite d'en envoyer une que l'exchange arrondirait ; la borne d'un
 * pourcentage, entre 10 % (accepté) et 100 % (refusé).
 * ============================================================================
 */

/** Ce que l'appelant demande, avant validation. Les décimales sont du texte, jamais un `number`. */
export interface TrailingStopRequest {
  isBuy: boolean;
  sz: string;
  reduceOnly: boolean;
  retracement: { pct?: string; px?: string };
  /** Absent ou `null` : le suivi commence tout de suite. */
  activationPx?: string | null;
}

/** Le marché résolu par le registre : un perp du dex principal. */
export interface TrailingStopMarket {
  asset: number;
  szDecimals: number;
}

export class TrailingStopRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrailingStopRequestError';
  }
}

/** Les décimales que l'action accepte d'écrire en pourcentage : celles du client officiel. */
export const TRAILING_PCT_DECIMALS = 4;

const PLAIN_DECIMAL = /^\d+(?:\.\d+)?$/;

export function buildTrailingStopAction(
  request: TrailingStopRequest,
  market: TrailingStopMarket,
): HLTrailingStopAction {
  const sz = onSizeGrid(request.sz, market.szDecimals);
  const retracement = toRetracement(request.retracement, market.szDecimals);
  const activationPx =
    request.activationPx === undefined || request.activationPx === null
      ? null
      : onPriceGrid('activationPx', request.activationPx, market.szDecimals);

  // L'ordre des clés est celui du hachage : ne pas le réordonner.
  return {
    type: 'trailingStop',
    asset: market.asset,
    isBuy: request.isBuy,
    sz,
    reduceOnly: request.reduceOnly,
    retracement,
    activationPx,
  };
}

function toRetracement(
  retracement: TrailingStopRequest['retracement'],
  szDecimals: number,
): HLTrailingRetracement {
  const hasPct = retracement.pct !== undefined;
  const hasPx = retracement.px !== undefined;
  if (hasPct === hasPx) {
    throw new TrailingStopRequestError(
      'retracement must carry exactly one of pct or px',
    );
  }
  if (hasPx) {
    return {
      px: onPriceGrid('retracement.px', retracement.px as string, szDecimals),
    };
  }
  return { pct: encodePct(retracement.pct as string) };
}

/**
 * `"10"` → `"10.0000%"`, l'écriture du client officiel (`toFixed(4) + '%'`),
 * obtenue sans passer par un `number`.
 */
export function encodePct(pct: string): string {
  requirePositiveDecimal('retracement.pct', pct);
  const [int, frac = ''] = pct.split('.');
  if (frac.length > TRAILING_PCT_DECIMALS) {
    throw new TrailingStopRequestError(
      `retracement.pct ${pct} has more than ${TRAILING_PCT_DECIMALS} decimals`,
    );
  }
  return `${stripLeadingZeros(int)}.${frac.padEnd(TRAILING_PCT_DECIMALS, '0')}%`;
}

function onSizeGrid(sz: string, szDecimals: number): DecimalString {
  requirePositiveDecimal('sz', sz);
  const onGrid = gridValue('sz', () => formatSize(sz, szDecimals));
  if (onGrid !== canonical(sz)) {
    throw new TrailingStopRequestError(
      `sz ${sz} is not on the size grid (${szDecimals} decimals): the nearest size below is ${onGrid}`,
    );
  }
  return onGrid;
}

function onPriceGrid(
  field: string,
  price: string,
  szDecimals: number,
): DecimalString {
  requirePositiveDecimal(field, price);
  const onGrid = gridValue(field, () => formatPrice(price, szDecimals, 'perp'));
  if (onGrid !== canonical(price)) {
    throw new TrailingStopRequestError(
      `${field} ${price} is not on the price grid: the nearest price below is ${onGrid}`,
    );
  }
  return onGrid;
}

/** La valeur sur la grille, ou un refus nommé quand la grille la réduit à zéro. */
function gridValue(field: string, format: () => string): string {
  try {
    return format();
  } catch (error) {
    if (error instanceof TickAndLotError) {
      throw new TrailingStopRequestError(`${field}: ${error.message}`);
    }
    throw error;
  }
}

function requirePositiveDecimal(field: string, value: string): void {
  if (!PLAIN_DECIMAL.test(value)) {
    throw new TrailingStopRequestError(
      `${field} must be a plain positive decimal, got ${JSON.stringify(value)}`,
    );
  }
  if (!/[1-9]/.test(value)) {
    throw new TrailingStopRequestError(`${field} must be greater than zero`);
  }
}

/** La décimale sans zéro de tête ni de queue : la forme que rend la grille. */
function canonical(value: string): string {
  const [int, frac = ''] = value.split('.');
  const kept = frac.replace(/0+$/, '');
  return kept ? `${stripLeadingZeros(int)}.${kept}` : stripLeadingZeros(int);
}

function stripLeadingZeros(int: string): string {
  return int.replace(/^0+(?=\d)/, '');
}

/**
 * Une activation du mauvais côté du prix marqué, ou `null` si elle est du bon.
 *
 * **Mesuré le 2026-11-17** : l'exchange ACCEPTE une vente dont l'activation est
 * sous le marqué, et la condition « au-dessus de » étant déjà remplie, le suivi
 * commence tout de suite (`Activation above 1719.4 … best 1809.9` pour un
 * marqué de 1 809,9). L'ordre posé n'est pas celui qu'on a demandé, et rien ne
 * le dit. Le client officiel refuse cette saisie : à la vente l'activation doit
 * être au-dessus du marqué, à l'achat en dessous. On applique la même règle,
 * égalité comprise — une activation au marqué n'attend rien.
 *
 * ⚠️ Le marqué est lu un instant avant la signature : une activation à
 * quelques ticks du marqué peut être franchie entre les deux. L'écart est celui
 * d'un marché qui bouge, pas d'une saisie inversée.
 */
export function activationSideRefusal(
  isBuy: boolean,
  activationPx: string,
  markPx: string,
): string | null {
  const activation = Number(activationPx);
  const mark = Number(markPx);
  if (!Number.isFinite(mark) || mark <= 0) {
    return `the mark price reads "${markPx}": the activation side cannot be checked`;
  }
  const waits = isBuy ? activation < mark : activation > mark;
  if (waits) return null;
  return isBuy
    ? `a buy activates below the mark: activationPx ${activationPx} is not below the mark ${markPx}, so tracking would start at once`
    : `a sell activates above the mark: activationPx ${activationPx} is not above the mark ${markPx}, so tracking would start at once`;
}

/**
 * ============================================================================
 * LA RÉPONSE : TROIS ISSUES, DONT UNE QUI NE SAIT PAS
 *
 * - `placed` : `{ status: 'ok', response: { type: 'trailingStop', data: { oid } } }`,
 *   la forme de la doc, mesurée le 2026-11-17 (`docs/trailing-stop.md`) ;
 * - `refused` : `{ status: 'err', response: <texte> }`, le refus d'une action
 *   entière, que le client officiel lit ainsi ;
 * - `unknown` : tout le reste. **L'ordre a pu être posé** : l'action n'a pas
 *   de `cloid`, et seule une relecture des ordres ouverts le dira.
 *
 * Le refus doit être lu comme tel : renvoyer un succès sur une forme qu'on ne
 * reconnaît pas laisserait croire à un stop suiveur qui n'existe pas, et
 * renvoyer un refus laisserait croire qu'il n'existe pas alors qu'il suit le
 * prix.
 * ============================================================================
 */
export type TrailingStopAnswer =
  | { kind: 'placed'; oid: number }
  | { kind: 'refused'; message: string }
  | { kind: 'unknown' };

export function readTrailingStopAnswer(reply: unknown): TrailingStopAnswer {
  if (!isRecord(reply)) return { kind: 'unknown' };

  if (reply.status === 'err') {
    return typeof reply.response === 'string'
      ? { kind: 'refused', message: reply.response }
      : { kind: 'unknown' };
  }

  if (reply.status !== 'ok' || !isRecord(reply.response)) {
    return { kind: 'unknown' };
  }
  const { type, data } = reply.response;
  if (type !== 'trailingStop' || !isRecord(data)) return { kind: 'unknown' };

  const { oid } = data;
  return typeof oid === 'number' && Number.isSafeInteger(oid) && oid > 0
    ? { kind: 'placed', oid }
    : { kind: 'unknown' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
