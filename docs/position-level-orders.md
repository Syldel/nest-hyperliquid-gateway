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

## Mesuré le 2026-10-27 (phase 1, pas 1 à 4 ; ETH, mainnet, un essai par pas)

- **Notre action signée est acceptée.** Un stop de position créé par `POST /orders/position-protective` (ETH, long de 0,011,
  déclencheur 2310,5) est ouvert : `oid 587180894330`, `SELL`, `Stop Market`, `sz 0.0`, `reduceOnly true`,
  `positionTpsl true` (lu dans les ordres ouverts). `s: "0"`, `positionTpsl`, `r: true` et un déclencheur au marché passent.
- **La réponse n'a pas la forme d'un ordre ordinaire.** Le statut est la CHAÎNE `"waitingForTrigger"`, **sans oid**. Le premier
  jet lisait `'error' in status` dessus : un `TypeError`, donc un **500 alors que l'ordre était posé** — le bot a lu
  `UNKNOWN_ORDER_STATE`, à raison. Corrigé le jour même (`requireAcceptedOrder`, quatre tests qui tombent sur l'ancien code).
  Les tests du premier jet utilisaient la forme ordinaire (`resting`) : une simulation qui n'avait pas été copiée d'une
  mesure. L'enveloppe autour de la chaîne n'a pas été capturée entière (le gateway a levé avant de la journaliser) ; elle est
  celle que le code lisait, `response.response.data.statuses[0]`.
- **Conséquence pour l'adoption : l'oid d'un ordre de position ne se lit que dans les ordres ouverts**, jamais dans la réponse
  de sa création. `modify` et `cancel` demandent un oid : retrouver le bon suppose de relire le carnet, et de savoir lequel
  des ordres de position est le sien s'il y en a plusieurs.
- **Dans `historicalOrders`, il est indiscernable d'un stop posé par l'interface** : `isPositionTpsl: true`, `sz 0.0 of 0.0`,
  `Price below 2310.5`, `limit 2079.5` (la borne de 10 % du gateway, reprise telle quelle), `children 0`.
- **Un take-profit ordinaire qui s'exécute n'a PAS emporté le stop de position** (pas 2). Un TP ordinaire (groupe `na`, taille
  0,0050, au marché, `oid 587188535995`) a rempli 0,005 sur 0,011 en deux exécutions à 2319,0 ; la position est passée à
  0,006 ; le stop `587180894330` est resté `open`, `sz 0.0`, `isPositionTpsl true`, **sans `siblingFilledCanceled`**. La
  fratrie vue le 2026-10-26 reliait deux ordres créés ensemble par l'interface ; elle n'a pas été observée entre deux ordres
  créés séparément. **Un seul stop, un seul take-profit, une seule mesure.**
- **Pas 3 : `modify` est accepté, et l'exchange REMPLACE l'ordre.** Réponse brute (journal du gateway) :
  `{"status":"ok","response":{"type":"default"}}`, l'accusé générique, sans statut ni oid. L'ancien stop (`587180894330`)
  passe `canceled` à 1793099928800 ; le nouveau (`587193821618`) est créé à la **même milliseconde**, `sz 0.0` conservé, borne
  recalculée (2081,8 pour 2313,0). Aucune fenêtre sans stop n'est visible. **L'oid change à chaque modification** : un oid
  mémorisé est périmé, il se relit dans les ordres ouverts.
- **Pas 4 : le stop créé par l'API ferme la position telle qu'elle est au déclenchement.** Modifié vers un déclencheur déjà
  franchi (2319,0, marque 2314,6 ; nouvel oid `587194721203`), il a été exécuté environ 3 s plus tard : `Close Long 0.006 @
  2314.5` — **0,006, la position restante**, et non 0,011, la position à sa création. Son `origSz` est passé de `0.0` à
  `0.006` au déclenchement. Compte à plat, aucun ordre ouvert.
- **Un déclencheur déjà franchi n'est pas exécuté à la milliseconde** : 3,03 s entre l'annulation de l'ancien stop
  (11:20:24.026Z) et l'exécution du nouveau (11:20:27.058Z), horloge de l'exchange. Le take-profit ordinaire du pas 2 est
  aussi apparu `resting` dans le listing qui a suivi son envoi : ce n'est pas propre aux ordres de position.
- Latent, non touché : `placeProtectiveOrder` lit toujours `'error' in status` sans garde. Il ne reçoit aujourd'hui que des
  statuts-objets ; une chaîne (`waitingForFill` existe pour les enfants d'un `normalTpsl`) le ferait tomber de la même façon.

## ⚠️ Ce qui n'est pas mesuré

- Ce que **plusieurs** take-profit ordinaires font d'un stop de position (un seul a été mesuré, un escalier en a
  plusieurs), et ce qui se passe si un TP de position partage son groupe avec le stop.
- Un stop créé **par l'API** devant une position qui **grandit** : mesuré par l'interface le 2026-10-26 (0,011 fermés pour un
  stop posé sur 0,006), pas par l'API ; les pas 1 à 4 ont fait rétrécir la position.
- Un autre actif qu'ETH, et plus d'un essai par pas.
- Les chemins existants qui touchent des ordres du compte sans savoir qu'ils sont « de position » : `smart-order`
  (réalignement par `batchModify`) les traiterait comme les siens, avec une taille. Non observé, non modifié.

## La route de l'historique d'ordres

`GET /hyperliquid/orders/historical` rend les 2 000 derniers enregistrements d'ordres du compte, **un par état traversé** (un
ordre annulé après avoir reposé y figure deux fois). Elle passe par `executeInfo` : le garde de débit compte son poids,
20 plus 1 par tranche de 20 enregistrements (au plus 120). Un script qui appelait `api.hyperliquid.xyz` directement,
avant elle, échappait à ce compte.
