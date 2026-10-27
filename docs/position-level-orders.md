# Les ordres « de position »

## Ce que c'est

Un TP/SL posé par le bouton « Position TP/SL » de l'interface n'a **pas de taille** : Hyperliquid l'écrit `0.0`
(`sz` et `origSz`) tant qu'il est armé, et le résout au déclenchement sur la position **telle qu'elle est alors**.
Il porte `isPositionTpsl: true` dans les ordres ouverts. Un stop et un take-profit posés ensemble sont liés : quand l'un
s'exécute, l'autre finit `siblingFilledCanceled`, à la même milliseconde.

Mesuré en réel le 2026-10-26 (ETH), par l'interface : un stop posé sur 0,006 a fermé **0,011** après que la position eut
grandi de 0,005 ; le take-profit lié a fini `siblingFilledCanceled`. Voir le dépôt du bot, `docs/known-gaps.md`, « À
considérer plus tard », et `docs/hyperliquid/live-check.md`.

## Ce que le gateway sait en poser, depuis le 2026-10-27 : une famille de routes à part

| Route | Corps | Ce qu'elle fait |
| --- | --- | --- |
| `POST /orders/position-protective` | `assetName`, `kind` (`tp` ou `sl`), `isBuy`, `price`, `isTestnet?` | pose un TP/SL de position |
| `POST /orders/position-protective/modify` | idem, plus `oid` | le modifie |

L'annulation n'a pas de route propre : `POST /hyperliquid/order/cancel` annule un ordre de position comme un autre.

**Il n'y a pas de `sz`**, et le ValidationPipe global (`forbidNonWhitelisted`) refuse un corps qui en porte un, avant toute
signature. Il n'y a pas non plus de choix entre déclencheur au marché et limite : seule la forme vue (au marché) existe.

Sur le fil, l'action est exactement :

```json
{
  "type": "order",
  "orders": [
    { "a": 1, "b": false, "p": "2076.5", "s": "0", "r": true,
      "t": { "trigger": { "isMarket": true, "triggerPx": "2307.2", "tpsl": "sl" } } }
  ],
  "grouping": "positionTpsl"
}
```

(`modify` : `{ "type": "modify", "oid": …, "order": { … } }`, sans groupe.) Le `"0"` est écrit à **un seul endroit**,
`HyperliquidApiTradeService.toPositionLevelApiOrder`. La borne `p` est celle des autres déclencheurs au marché
(`marketTriggerLimitPx`, voir `protective-order-price.md`).

## Pourquoi une famille à part, et non un zéro toléré par les routes existantes

`formatSize` refuse un zéro (« Size is too small and was truncated to 0 ») et c'est voulu : un zéro qui traverserait le
chemin des ordres ordinaires — celui du réalignement des protections du bot, du balayage de poussière, de l'escalade, de
l'application mobile — serait indiscernable d'une taille perdue en route. **Aucune route existante, aucun DTO existant et
aucune fonction de conversion n'ont changé** : `convertToApiOrder` refuse toujours un zéro, et un test le fige. Seul un type
d'un paramètre privé de `SmartOrderService.marketTriggerLimitPx` a été élargi (`Pick`), sans effet sur son comportement.

## Ce que disent d'autres sources de la forme du fil (lues le 2026-10-27)

- La doc de l'API ne donne que `"s": String` et le groupe `positionTpsl` : rien sur la taille.
- **CCXT** envoie un TP/SL de position avec `amount = '0'`, des déclencheurs **au marché**, `reduceOnly: true` et aucun ordre
  parent, et commente : « a size of zero is meaningful to hyperliquid ».
- **nktkas/hyperliquid** type `s` comme un décimal non négatif (zéro permis ; seuls `p` et `triggerPx` doivent être > 0), et
  décrit `positionTpsl` comme « s'ajustant proportionnellement à la position ».
- L'application officielle passe `userSz: 0` pour un TP/SL de position, et en modifie un par `modify` sur son oid quand on le
  glisse sur le graphique.
- Le SDK Python officiel passe `grouping` tel quel ; le SDK Rust officiel écrit `"na"` en dur.

## ⚠️ Ce qui n'est pas mesuré

- Que **notre** action signée soit acceptée par l'exchange. La première réponse à cette requête est la mesure : le script de
  sonde du bot (`scripts/live-check/position-stop-api.ts`) existe pour la lire.
- Ce que fait `modify` d'un ordre de position par l'API (l'interface le fait, par le graphique ; sa fenêtre, elle, annule puis
  recrée).
- Ce qu'un take-profit **ordinaire** qui s'exécute fait d'un stop de position : l'emporte-t-il en fratrie ? C'est la
  question qui décide de l'adoption dans le bot.
- Les chemins existants qui touchent des ordres du compte sans savoir qu'ils sont « de position » : `smart-order`
  (réalignement par `batchModify`) les traiterait comme les siens, avec une taille. Non observé, non modifié.

## La route de l'historique d'ordres

`GET /hyperliquid/orders/historical` rend les 2 000 derniers enregistrements d'ordres du compte, **un par état traversé** (un
ordre annulé après avoir reposé y figure deux fois). Elle passe par `executeInfo` : le garde de débit compte son poids,
20 plus 1 par tranche de 20 enregistrements (au plus 120). Un script qui appelait `api.hyperliquid.xyz` directement,
avant elle, échappait à ce compte.
