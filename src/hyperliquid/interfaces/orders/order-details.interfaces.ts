export type DecimalString = string;

/**
 * Détails d'un ordre à placer sur Hyperliquid.
 *
 * @interface HLOrderDetails
 *
 * @property {number} asset - Identifiant numérique de l'actif à trader.
 * @property {boolean} isBuy - True pour un ordre d'achat, false pour un ordre de vente.
 * @property {DecimalString} limitPx - Prix limite pour l'ordre (pour limit orders).
 * @property {DecimalString} sz - Taille (quantité) de l'ordre.
 * @property {boolean} reduceOnly - True si l'ordre est uniquement pour réduire une position existante.
 * @property { { limit: { tif: 'Alo' | 'Ioc' | 'Gtc' } } | { trigger: { isMarket: boolean, triggerPx: DecimalString, tpsl: 'tp' | 'sl' } } } orderType
 *   - Type d'ordre :
 *     - **Limit Order** : { limit: { tif } } où `tif` définit le comportement du temps de vie de l'ordre :
 *
 *       | TIF | Comportement |
 *       |-----|--------------|
 *       | **Alo** | Post-only, annule si risque d’exécution immédiate |
 *       | **Ioc** | Immediate or Cancel, exécute ce qui peut être pris, annule le reste |
 *       | **Gtc** | Good Till Cancelled, reste sur le carnet jusqu’à annulation manuelle ou exécution |
 *
 *     - **Trigger Order** : { trigger: { isMarket, triggerPx, tpsl } } pour TP/SL
 *       - `isMarket` : True si l'ordre se déclenche au prix du marché
 *       - `triggerPx` : Prix de déclenchement
 *       - `tpsl` : "tp" pour Take Profit, "sl" pour Stop Loss
 * @property {string} [cloid] - Client Order ID optionnel (128-bit hex string, ex. "0x1234...").
 */
export interface HLOrderDetails {
  assetName: string; // "BTC", "HYPE/USDC", "test:ABC", etc.
  isBuy: boolean;
  limitPx: DecimalString;
  sz: DecimalString;
  reduceOnly: boolean;
  orderType:
    | { limit: { tif: 'Alo' | 'Ioc' | 'Gtc' } }
    | {
        trigger: {
          isMarket: boolean;
          triggerPx: DecimalString;
          tpsl: 'tp' | 'sl';
        };
      };
  cloid?: string;
}

/**
 * Représente un ordre formaté pour l'API Hyperliquid.
 * Les clés correspondent exactement à ce que l'API attend.
 */
export interface HLApiOrder {
  a: number; // asset
  b: boolean; // isBuy
  p: DecimalString; // prix limite
  s: DecimalString; // taille
  r: boolean; // reduceOnly
  t:
    | { limit: { tif: 'Alo' | 'Ioc' | 'Gtc' } }
    | {
        trigger: {
          isMarket: boolean;
          triggerPx: DecimalString;
          tpsl: 'tp' | 'sl';
        };
      };
  c?: string; // cloid optionnel
}
