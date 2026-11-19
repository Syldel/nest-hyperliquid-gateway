# Le trailing stop natif

## Ce que c'est

Hyperliquid a ajouté le 2026-09-21 un **trailing stop natif** : un ordre de l'exchange dont le déclencheur suit le
meilleur prix vu (le _watermark_) à une distance donnée, en pourcentage ou en prix, à partir d'un prix d'activation ou tout
de suite. C'est l'exchange qui le fait suivre, pas le bot.

Il **s'ajoute** au stop-loss du bot et ne le remplace jamais. Le bot ne le compte pas comme sa protection et le laisse
en place ; `placeBatchProtectiveOrders` l'exclut de ses ordres protecteurs (garde-fou du 2026-11-16,
`PROTECTIVE_KIND_BY_ORDER_TYPE` dans `smart-order.service.ts`).

Ce qu'en rendent les lectures (`frontendOpenOrders`), mesuré le 2026-11-16 sur des ordres posés à la main dans
l'interface : `orderType` `"Trailing Stop Market"`, l'état en texte libre dans `triggerCondition`
(`Activation immediate, retracement 10%, best 1828.3`), `triggerPx` = le déclencheur courant, hors grille, et `"0.0"` tant
que le suivi attend. Le relevé complet : dépôt du bot, `docs/hyperliquid/live-check.md`, « Le trailing stop natif : ce
que l'API en rend ». Le lecteur strict de `triggerCondition` est dans `@syldel/hl-shared-types`
(`parseTrailingStopCondition`).

## La route, depuis le 2026-11-17

| Route                        | Corps                                                                                                          | Rend                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `POST /orders/trailing-stop` | `assetName`, `isBuy`, `sz`, `reduceOnly`, `retracement` (`{ pct }` ou `{ px }`), `activationPx?`, `isTestnet?` | `{ oid, action }` signée |

- **`reduceOnly` est obligatoire.** Fermer une position et en ouvrir une sont deux intentions ; rien ne se déduit.
- **`pct` est en points** : `"10"` pour 10 %, au plus quatre décimales.
- **Sans `activationPx`**, le suivi commence tout de suite (`null` explicite sur le fil).
- **Pas de `cloid`** : l'action n'en a pas, et le ValidationPipe refuse un corps qui en porte un.
- **Pas de modification** : ni la doc ni l'interface officielle n'en proposent pour ce type. Remplacer, c'est poser le
  nouveau puis annuler l'ancien, et **le suivi repart du prix courant**. L'annulation est la route ordinaire,
  `POST /hyperliquid/order/cancel`, par oid.

Le code : `utils/trailing-stop-action.ts` (construction de l'action et lecture de la réponse, en fonctions pures),
`services/trailing-stop.service.ts`, `controllers/trailing-stop.controller.ts`, `dtos/trailing-stop.dtos.ts`.

## Ce que le gateway refuse avant de signer (400)

| Code                                  | Pourquoi                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `TRAILING_STOP_MARKET_UNSUPPORTED`    | pas un perp : spot, outcome (pas de trailing stop) ; ou un nom HIP-3 que le registre lie à un autre genre d'actif |
| `UNKNOWN_ASSET`                       | inconnu du registre                                                                                               |
| `TRAILING_STOP_INVALID`               | hors grille, nul, plus de quatre décimales en `pct`, ni ou les deux de `pct` / `px`                               |
| `TRAILING_STOP_ACTIVATION_WRONG_SIDE` | activation du mauvais côté du marqué (ou au marqué) : sous lui pour une vente, au-dessus pour un achat            |
| `INVALID_MARKET_DATA`                 | une activation est demandée et le marqué est illisible : rien n'est signé sans ce contrôle                        |

**Le sens de l'activation** se contrôle contre le prix marqué, lu par `metaAndAssetCtxs` (poids 20, la lecture des ordres
instantanés) **seulement quand une activation est demandée**. L'exchange, lui, accepte le mauvais côté et suit tout de
suite (mesuré le 2026-11-17, voir plus bas). ⚠️ Le marqué est lu un instant avant la signature : une activation à quelques
ticks peut être franchie entre les deux.

⚠️ **Le code ne parvient pas à l'appelant** (mesuré le 2026-11-17). Le filtre global `ValidationExceptionFilter` réécrit
tout 400 en `{"statusCode":400,"message":"Validation failed","errors":<texte>}` : le texte du refus passe dans `errors`,
le code est perdu. Vrai de tous les 400 du gateway, pas seulement de cette route.

**Une valeur hors grille est refusée, jamais tronquée**, avec la valeur la plus proche en dessous dans le message. Un
stop suiveur dont la taille ou la distance auraient été rabotées en silence n'est plus celui qu'on a demandé. La grille
est celle du paquet partagé (`formatSize`, `formatPrice`), la même que le bot et le mobile.

## Sur le fil

```json
{
  "type": "trailingStop",
  "asset": 1,
  "isBuy": false,
  "sz": "0.0065",
  "reduceOnly": true,
  "retracement": { "pct": "10.0000%" },
  "activationPx": null
}
```

Trois choses que le type ne dit pas, toutes tirées du client officiel (`app.hyperliquid.xyz`, lu le 2026-11-16), la
seule forme connue pour être acceptée :

- **l'ordre des clés** est celui du hachage msgpack : `type, asset, isBuy, sz, reduceOnly, retracement, activationPx` ;
- **`pct` s'écrit avec quatre décimales et un `%`** (`toFixed(4) + '%'`). La doc donne `"1.234%"` en exemple ; rien ne
  dit si l'exchange normalise ce texte avant de hacher, donc on ne prend pas le pari ;
- **les décimales partent canoniques** (`"0.006"`, jamais `"0.0060"`). `SigningService.actionHash` ne retire les zéros
  finaux que des clés `p` et `s` des ordres ordinaires, et `executeWithNonce` envoie l'action d'origine. Un test vérifie
  que l'action hachée est l'action envoyée.

## Les réponses

| Réponse                                                               | Ce que rend la route                                              |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `{ status: 'ok', response: { type: 'trailingStop', data: { oid } } }` | `{ oid, action }`                                                 |
| `{ status: 'err', response: <texte> }`                                | 502 `EXCHANGE_TRAILING_STOP_REFUSED`, avec le texte de l'exchange |
| toute autre forme                                                     | 502 `EXCHANGE_UNEXPECTED_RESPONSE` : **il a pu être posé**        |
| une panne après l'envoi (réseau, HTTP)                                | 502 `EXCHANGE_OUTCOME_UNKNOWN` : **il a pu être posé**            |

**Aucune relance**, nulle part : sans `cloid`, un second envoi après une réponse perdue poserait un second stop suiveur
que rien ne distinguerait du premier. Une issue inconnue se lève avec la consigne de relire les ordres ouverts. La
réponse brute est journalisée, succès compris, tant que cette famille est en cours de mesure.

⚠️ Le bot traite tout 502 du gateway comme un état inconnu (`UnknownOrderStateError`), y compris un refus franc de
l'exchange. C'est vrai de tous les `EXCHANGE_ERROR_*`, pas seulement de cette route ; sans effet tant que le moteur ne
pose pas de trailing stop.

## Mesuré le 2026-11-17

ETH, à la vente, pas à pas S1 à S4. Le détail : dépôt du bot, `docs/hyperliquid/live-check.md`, « Le trailing stop natif
posé par le gateway ».

- **Notre signature est acceptée et la réponse a la forme de la doc** :
  `{"status":"ok","response":{"type":"trailingStop","data":{"oid":607975946526}}}`, en pourcentage sans activation comme
  en distance en prix avec activation, reduce-only ou non.
- **Un refus a la forme `HLRefusedResponse`** : `{"status":"err","response":"Trailing stop retracement is invalid."}` pour
  un repli de 100 %. La borne exacte reste inconnue (10 % passe).
- ⚠️ **Une activation du mauvais côté est ACCEPTÉE**, pas refusée : une vente avec `activationPx` sous le marqué a
  commencé à suivre tout de suite (`Activation above 1719.4 … best 1809.9`). L'ordre posé n'est pas celui qu'on croit
  avoir demandé, et rien ne le signale. Le client officiel refuse cette saisie ; **le gateway aussi, depuis le même
  jour** (`TRAILING_STOP_ACTIVATION_WRONG_SIDE`, ci-dessus).
- Un trailing stop s'annule par un `cancel` ordinaire, en lot.
- **Un achat** (12:55Z, S5) : accepté, en suivi immédiat comme en attente (`Activation below 1250 … best waiting`). Le
  stop vaut le meilleur prix × (1 + repli), et `limitPx` ≈ stop × 1,1, miroir du × 0,9 de la vente.
- **Le pourcentage relu porte un artefact de flottant** : `retracement 3.5000000000000004%` pour 3,5 % posé depuis
  l'interface officielle. Un lecteur ne doit pas le comparer en texte à ce qu'il a signé.
- **`orderStatus` rend l'état de la pose, figé ; `frontendOpenOrders` suit le watermark** (S5 puis S6, BTC). Un achat
  reduce-only à 0,3 % a été rempli à 65 000, 0,255 % sous le stop figé d'`orderStatus` : ce stop n'était pas appliqué.
  L'état courant d'un trailing stop se lit donc dans `frontendOpenOrders`, jamais dans `orderStatus`. Le relevé : dépôt
  du bot, `docs/hyperliquid/live-check.md`, S5 et S6.
- **Un déclenchement** se remplit sous l'oid du trailing ; l'ordre passe `filled`, son `triggerCondition` devient
  `"Triggered"` et `triggerPx` `"0.0"`.
- **Sur un dex HIP-3** (2026-11-19, `xyz:BRENTOIL`, S7) : notre signature est acceptée sous la même réponse, pour l'actif
  **110049** (= 100000 + 1 × 10000 + 49, la règle du registre) ; relu dans `frontendOpenOrders` de `xyz` sous la même
  forme, le stop = best × 0,9 au chiffre près, monté avec un nouveau plus haut ; annulé par la route ordinaire. Le refus
  du mauvais côté cite le marqué lu sur `xyz` (90,616). Ouvert par `d7f8273` : il était refusé, et le marqué du contrôle
  d'activation se lisait au dex principal.

## ⚠️ Ce qui n'est pas mesuré

- une activation atteinte ; un déclenchement à la vente ;
- qu'une **distance en prix** (`retracement.px`) doive tomber sur la grille de prix : elle n'est pas un prix, mais la
  tenir sur la grille évite d'en envoyer une que l'exchange arrondirait ;
- les **bornes** d'un pourcentage acceptable, entre 10 % (accepté) et 100 % (refusé) ;
- sur un **dex HIP-3** : une activation atteinte, un déclenchement, un achat (seule une vente reduce-only immédiate y
  est mesurée, S7).

La sonde qui les mesure, à la main de l'utilisateur et un pas à la fois : dépôt du bot,
`scripts/live-check/trailing-stop-api.ts`.
