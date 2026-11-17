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

| Code                               | Pourquoi                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `TRAILING_STOP_MARKET_UNSUPPORTED` | pas un perp du dex principal : spot, outcome (pas de trailing stop), dex HIP-3 (non mesuré) |
| `UNKNOWN_ASSET`                    | inconnu du registre                                                                         |
| `TRAILING_STOP_INVALID`            | hors grille, nul, plus de quatre décimales en `pct`, ni ou les deux de `pct` / `px`         |

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

## ⚠️ Ce qui n'est pas mesuré

- **notre signature** : une action neuve, jamais envoyée par ce gateway. Un hachage faux se lirait « User or API Wallet
  … does not exist » ;
- **la forme de la réponse** : celle de la doc, jamais vue ;
- **les refus** : leur forme et leur texte (activation du mauvais côté, pourcentage démesuré) ;
- qu'une **distance en prix** (`retracement.px`) doive tomber sur la grille de prix : elle n'est pas un prix, mais la
  tenir sur la grille évite d'en envoyer une que l'exchange arrondirait ;
- les **bornes** d'un pourcentage acceptable ;
- le **sens de l'activation** : le client officiel exige, à l'achat, une activation sous le prix marqué et, à la vente,
  au-dessus. Le gateway ne le contrôle pas : l'exchange a le prix marqué, et son refus se lit dans la réponse ;
- un **dex HIP-3** : refusé par le gateway tant qu'il n'est pas mesuré.

La sonde qui les mesure, à la main de l'utilisateur et un pas à la fois : dépôt du bot,
`scripts/live-check/trailing-stop-api.ts`.
