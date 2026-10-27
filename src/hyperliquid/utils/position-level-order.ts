import type { DecimalString } from '@syldel/hl-shared-types';

/**
 * ============================================================================
 * L'ORDRE « DE POSITION » : SA TAILLE EST TOUTE LA POSITION, LUE AU DÉCLENCHEMENT
 *
 * Un TP/SL posé par le bouton « Position TP/SL » de l'interface n'a pas de taille : Hyperliquid l'écrit `0.0`
 * (`sz` et `origSz`) tant qu'il est armé, et le résout au déclenchement sur la position **telle qu'elle est alors**.
 * Mesuré en réel le 2026-10-26 (ETH) : un stop posé sur 0,006 a fermé 0,011 après que la position eut grandi ; le
 * take-profit lié a fini `siblingFilledCanceled` à la même milliseconde.
 *
 * **Ce que dit le fil, d'après des sources qui ne sont pas nos mesures** (lues le 2026-10-27) :
 *
 * - la doc de l'API ne donne que `"s": String` et le groupe `positionTpsl` : rien sur la taille ;
 * - **CCXT** envoie un TP/SL de position avec `amount = '0'`, des déclencheurs **au marché**, `reduceOnly: true` et
 *   aucun ordre parent, et commente : « a size of zero is meaningful to hyperliquid » ;
 * - **nktkas/hyperliquid** type `s` comme un décimal non négatif (zéro permis ; seuls `p` et `triggerPx` doivent être
 *   > 0) ;
 * - l'application officielle passe `userSz: 0` pour un TP/SL de position, et en modifie un par `modify` sur son oid
 *   quand on le glisse sur le graphique ;
 * - le SDK Python officiel passe `grouping` tel quel ; le SDK Rust officiel écrit `"na"` en dur.
 *
 * **Pourquoi une méthode à part, et non un zéro toléré par `convertToApiOrder`.** `formatSize` refuse un zéro
 * (« Size is too small and was truncated to 0 ») et c'est voulu : un zéro qui traverserait le chemin des ordres
 * ordinaires serait indiscernable d'une taille perdue en route. L'ordre de position a donc sa propre entrée, qui n'a
 * AUCUN champ de taille — il n'y a rien à perdre — et qui écrit le `"0"` du fil à un seul endroit.
 *
 * ⚠️ **Ce que l'API fait de cet ordre n'est pas mesuré** : que notre action signée soit acceptée ; ce que fait
 * `modify` ; et surtout ce qu'un take-profit ORDINAIRE qui s'exécute fait d'un stop de position (l'emporte-t-il en
 * fratrie ?). C'est la phase 1 du dépôt du bot (`scripts/live-check/position-stop-api.ts`).
 * ============================================================================
 */
export interface PositionLevelOrder {
  assetName: string;
  /** Le côté de l'ORDRE, donc de la clôture : vendre ferme un long. */
  isBuy: boolean;
  /**
   * La borne que l'exchange recalcule pour un déclencheur au marché (déclencheur × 0,9 ou × 1,1) : voir
   * `MARKET_TRIGGER_LIMIT_FACTOR` dans `smart-order.service.ts`. Le champ reste obligatoire dans le format d'ordre.
   */
  limitPx: DecimalString;
  triggerPx: DecimalString;
  tpsl: 'tp' | 'sl';
}

/** La taille sur le fil. L'exchange la rend `0.0` ; `"0"` est la forme canonique d'un décimal nul. */
export const POSITION_LEVEL_WIRE_SIZE = '0';

/** Le seul groupe où un ordre de position se pose. */
export const POSITION_LEVEL_GROUPING = 'positionTpsl' as const;
