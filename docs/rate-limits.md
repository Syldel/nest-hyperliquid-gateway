# Limites de débit Hyperliquid

## Pourquoi ce document existe

Hyperliquid limite le débit **par IP**, et sa documentation ne dit ni quel code d'erreur ni
quelle durée de bannissement s'appliquent au-delà. Un bannissement de l'IP coupe le bot de
trading sans préavis. Il n'y a donc aucune marge pour apprendre en production.

Ce gateway est la **seule** sortie vers Hyperliquid pour le bot. C'est ici, et nulle part
ailleurs, que l'IP peut être protégée.

## Les chiffres

Source : [Rate limits and user limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits),
relevés le 2026-09-21.

**Par IP : 1200 de poids par minute**, lectures et actions confondues.

| Requête | Poids |
| --- | --- |
| `l2Book`, `allMids`, `clearinghouseState`, `orderStatus`, `spotClearinghouseState`, `exchangeStatus` | 2 |
| toute autre lecture `/info` (dont `meta`, `metaAndAssetCtxs`, `frontendOpenOrders`, `perpDexs`, `spotMeta`) | 20 |
| `candleSnapshot` | 20 + 1 par tranche de 60 bougies rendues |
| `userFills`, `historicalOrders`, `fundingHistory`… | 20 + 1 par tranche de 20 éléments rendus |
| `userRole` | 60 |
| action `/exchange` | 1 + floor(taille du lot / 40) |

**Par adresse** (distinct de l'IP) : 10 000 requêtes de réserve initiale, puis 1 requête par
USDC échangé depuis la création de l'adresse. Au-delà, une requête toutes les 10 s. Le refus
se signale par un message du type « Too many cumulative requests sent (x > y) for cumulative
volume traded $z ».

## Où est le garde-fou

Tout le trafic vers Hyperliquid passe par **deux** fonctions :

- `HyperliquidApiBaseInfoService.executeInfo` — les lectures `/info` ;
- `HyperliquidApiTradeService.executeWithNonce` — les actions `/exchange`.

Les deux passent par `HyperliquidRateGuardService`
(`src/hyperliquid/services/hyperliquid-rate-guard.service.ts`). **Tout nouvel appel à
Hyperliquid doit passer par l'une d'elles, jamais par un `fetch` direct** : un appel qui les
contourne n'est ni compté, ni freiné.

Ce que fait le garde-fou :

1. **Un 429 d'Hyperliquid ouvre une pause globale.** Pendant la pause, aucun appel ne part —
   ni lecture ni ordre — : tout est refusé localement avec un 429, sans toucher le réseau.
2. **La pause double à chaque 429 consécutif** : 60 s, 2 min, 4 min, 8 min, puis 10 min au
   plus. Un `Retry-After` plus long est respecté ; un plus court ne raccourcit jamais la
   pause.
3. **Un plafond local à 80 % du budget** (960 de poids par minute glissante) : au-delà, les
   **lectures** sont refusées localement. Les **ordres** ne le sont jamais par ce plafond —
   refuser la fermeture d'une position parce qu'on a trop lu serait pire que le risque
   évité. Ils restent soumis à la pause du point 1.
4. **Le poids consommé est compté** à chaque réponse reçue, réussie ou non (Hyperliquid
   compte les deux). Un avertissement est journalisé au-delà de 50 %, au plus une fois par
   minute.
5. **La limite par adresse** est reconnue à son message, qu'elle arrive en HTTP 4xx ou dans
   le corps d'une réponse 200 (`status: "err"`). Elle ouvre la même pause.

Réponse envoyée au client dans tous ces cas : **HTTP 429**, corps
`{ statusCode: 429, error: 'HYPERLIQUID_RATE_LIMITED' | 'LOCAL_RATE_BUDGET', message }`.
Avant ce garde-fou, un 429 d'Hyperliquid devenait une `Error` nue, que Nest rendait en
**500** : le bot y lisait une panne passagère et relançait.

## Le démarrage ne fait plus planter le processus

`AssetRegistryService.onModuleInit` charge la liste des DEX, les métadonnées spot, puis
celles de **chaque** DEX : environ **260 de poids** à chaque démarrage (11 DEX le
2026-09-21). Le rafraîchissement périodique (`MARKET_REFRESH_INTERVAL_MS`, 4 h dans `.env`)
coûte autant.

Si ce chargement échouait, l'exception remontait de `onModuleInit`, Nest ne démarrait pas,
le processus s'arrêtait — et l'hébergeur le relançait aussitôt (Docker double le délai en
partant de 100 ms). Chaque relance rappelait Hyperliquid ; si l'échec était un refus de
débit, chaque relance aggravait la sanction. **C'était le scénario de bannissement le plus
plausible de toute la chaîne.**

Désormais le processus reste debout, journalise l'échec, et retente après 60 s, puis 2 min,
4 min… jusqu'à 15 min. Tant que les symboles manquent, les requêtes qui en dépendent échouent
avec une erreur explicite.

## Le contrat avec les clients

Ce que le bot (`nest-trading-bot`) fait de ces réponses, et que tout autre client doit
respecter :

- **un 429 ne se relance jamais** ;
- **une écriture n'est jamais relancée automatiquement** : sans réponse claire, l'ordre a
  peut-être été exécuté ;
- **le délai d'une écriture côté client doit dépasser la durée maximale d'un ordre
  instantané ici** : `SmartOrderService.instantOrder` fait jusqu'à 6 tentatives espacées de
  7,5 s, puis suit le statut jusqu'à 45 s — environ **100 s** au pire. Le bot attend 180 s.

## ⚠️ Ce qui n'est pas vérifié, et les limites connues

- **L'état vit en mémoire.** Un redémarrage remet le compteur et la pause à zéro. C'est
  pourquoi le démarrage ne doit pas pouvoir planter (voir plus haut).
- **Le code d'erreur de la limite par IP n'est pas documenté** par Hyperliquid. On suppose
  un HTTP 429, la norme. S'il se signalait autrement, il ne serait pas reconnu.
- **La forme exacte de la limite par adresse n'a jamais été observée** : seul le texte du
  message est documenté, c'est lui qui est reconnu.
- **Le mode watch coûte cher.** `npm run start:dev` redémarre le gateway à chaque
  sauvegarde, soit ~260 de poids par redémarrage. Plusieurs sauvegardes dans la même minute
  peuvent dépasser le budget **depuis la machine de développement**. Grouper les
  modifications, ou arrêter le watch pendant une grosse édition.
- **L'app mobile appelle `api.hyperliquid.xyz` directement** pour les données publiques :
  ce trafic ne passe pas par ici et n'est pas compté. En production c'est l'IP du
  téléphone ; en développement, c'est celle de la machine qui fait tourner le navigateur.
- **Un ordre `Alo` dont le suivi est interrompu par une pause reste posé** sur le carnet :
  le gateway ne peut pas l'annuler sans rappeler Hyperliquid. Le passage suivant du bot
  annule les ordres limites existants avant toute entrée.

## Comment c'est vérifié

`hyperliquid-rate-guard.service.spec.ts` (règles du garde-fou, poids, signaux) et
`hyperliquid-rate-guard.integration.spec.ts` (les deux points de sortie avec un `fetch`
simulé, et le démarrage). Éprouvés sur du code volontairement cassé : un 429 rendu en
`Error` nue, et un démarrage qui laisse remonter l'exception, font tomber les tests
concernés.
