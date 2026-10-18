# Ordres protecteurs : le prix limite `p` d'un déclencheur « au marché »

## En deux phrases

**Pour un déclencheur au marché, Hyperliquid ignore le `p` qu'on lui envoie** : à son
déclenchement, il recrée l'ordre avec sa propre borne de 10 %, quel que soit `p`. Mesuré le
2026-10-18 sur l'historique d'un compte réel (26 ordres déclenchés), et non déduit d'une
documentation qui, elle, ne le dit pas. Le gateway envoie cette borne dans `p` pour que l'ordre
au repos se lise comme l'ordre qui sera exécuté ; ce n'est **pas** une protection qu'il ajoute.

⚠️ Ce que cela ne couvre pas : un déclencheur **limite** (`isMarket: false`), où `p` est un vrai
plancher et n'a jamais été observé au déclenchement ; le comportement **dans un gap**, qui n'a pas
eu lieu pendant les mesures ; et le chemin des routes du gateway elles-mêmes, jamais appelées en
réel avec ce `p`.

## Pourquoi ce document existe

Un stop loss est la seule chose qui sépare une position d'une perte non bornée ; un stop qui se
déclenche sans s'exécuter est pire qu'une erreur visible, car rien ne le signale. Jusqu'au
2026-10-18 le gateway envoyait `p = triggerPx`, et la doc officielle laissait craindre qu'un SL
vendeur ainsi posé reste en attente dans un gap. Cette page garde la trace de ce qui a été
craint, de ce qui a été mesuré, et de ce qui ne l'a pas été.

## Ce que fait le gateway (depuis le 2026-10-18)

`SmartOrderService.toHLOrderDetails` (`src/hyperliquid/services/smart-order.service.ts`)
construit tout ordre protecteur — Take Profit ou Stop Loss, y compris ceux du bot — avec

```
limitPx = la borne de l'exchange   // déclencheur × 0,9 pour une vente (ferme un long),
                                   // × 1,1 pour un achat ; voir « L'arrondi » ci-dessous
trigger: { isMarket: true (par défaut), triggerPx, tpsl }
```

`limitPx` part dans le champ `p` de l'ordre (`hyperliquid-api-trade.service.ts`). Le champ est
**obligatoire** : le DTO le refuse absent. Un déclencheur **limite** (`isMarket: false`) garde
`p = triggerPx` : l'appelant ne donne qu'un prix, et en choisir un autre à sa place serait décider
d'un ordre qu'il a voulu précis. ⚠️ Pour celui-là, `p` est le prix de l'ordre posé au
déclenchement ; c'est le cas que la doc officielle donne pour rester en attente dans un gap. Aucun
appelant connu ne l'utilise.

**Avant le 2026-10-18**, `limitPx` valait `triggerPx`. Ce changement n'a **aucun effet sur
l'exécution** d'un déclencheur au marché, puisque l'exchange ignore `p` : il ne corrige donc pas un
défaut. Il aligne ce qu'on pose sur ce qui sera exécuté. Les protections déjà posées gardent
`p = triggerPx` tant que leur déclencheur ne bouge pas, sans conséquence.

## Ce qui a été mesuré (2026-10-18)

### La source : l'historique du compte

`historicalOrders` du compte de test rend, pour un ordre déclenché, **deux lignes** de même `oid` :
`triggered` (l'ordre tel que posé, avec son `p`) et `filled` (l'ordre exécuté, `triggerCondition:
"Triggered"`, `tif: "Gtc"`). Sur les **26 ordres au marché déclenchés** du compte (stops et
take-profits, BTC et SOL, achats et ventes, d'avril à octobre 2026) :

- le `p` posé n'a aucun rapport avec celui de la ligne `filled` : `p = triggerPx` pour 23 d'entre
  eux, `+8 %` pour un, `p` à 10 % pour les deux d'aujourd'hui ;
- la ligne `filled` porte **toujours** déclencheur × 0,9 (vente) ou × 1,1 (achat).

C'est ce qui établit que `p` est ignoré. L'ordre au repos affichait `p` tel que posé : seul
l'historique montre ce que l'exchange a fait.

### L'arrondi, tel qu'il se lit sur ces ordres

Un achat est **tronqué** ; une vente est **tronquée puis relevée d'un tick**, y compris quand le
produit tombe juste : 78130 × 0,9 = 70317 exactement, l'exchange écrit **70318** ; 79960 × 1,1 =
87956 exactement, il écrit **87956**. Cette règle reproduit les 26 ordres, les deux produits exacts
compris. ⚠️ **Déduite** de ces ordres, pas documentée : la raison du tick de plus pour une vente
est inconnue, et les deux produits exacts sont des entiers BTC. Sans conséquence tant que `p` est
ignoré. (Une première lecture attribuait l'écart du cas 78130 à de l'arithmétique flottante :
fausse, aucun calcul flottant ne donne 70317,00000000001 ici.)

### Un ordre réel, posé par le formulaire du mobile (pas par le gateway)

Stop Market BTC de 0,00014 puis 0,00015, déclencheur au marché, `p` à 10 % : accepté ; `p` rendu
tel que posé au repos (81937 → `73743.0`, y compris après une modification, qui est une annulation
suivie d'un nouvel `oid`) ; exécuté **au marché** (taker) à 1 $, puis 28 $ du déclencheur. Posé
sans position ouverte, il est accepté (reduce-only), puis actif quand l'entrée est exécutée. Un
Take Profit **limite** posé avec `p` à 1,5 % est accepté et rend son `p` (80730) ; il n'a pas été
déclenché. À la fermeture de la position par un autre ordre, l'exchange retire le reduce-only
restant, avec le statut `reduceOnlyCanceled`.

### Un déclencheur LIMITE : `p` est appliqué, et le trop serré reste au carnet

Mesuré le 2026-10-18 sur quatre ordres déclenchés (`xyz:BRENTOIL`, `io:ANTH`, ETH ; posés par le
formulaire du mobile, pas par le gateway) : la ligne `filled` de l'historique garde le `p` posé,
`tif: "Gtc"` — l'ordre posé au déclenchement est un ordre limite à ce prix. Contrairement au
déclencheur au marché, **`p` compte**.

Un Stop Limit ETH dont le limite était **égal** au déclencheur (2377.0) s'est déclenché, puis son
ordre limite de vente est resté au carnet **826 secondes** avant d'être exécuté en maker, quand le
prix est remonté : la position est restée ouverte, sans protection, pendant 13 min 46 s. Un limite à
5 % sous le déclencheur, lui, s'est exécuté tout de suite au meilleur acheteur (deux cas).

**Ce que cela dit du gateway** : `isMarket: false` y garde `p = triggerPx`, c'est-à-dire **le cas
mesuré qui reste au carnet**. Aucun appelant connu ne l'utilise (le bot et le mobile passent par
le marché), mais un jour quelqu'un le fera sans savoir. À décider : refuser `isMarket: false`, ou
exiger un limite explicite. Pas fait.

### Ce qui n'est pas mesuré

- **Un gap** : l'exécution s'est faite à 1 $ puis 28 $ du déclencheur. Cela montre qu'un stop au
  marché s'exécute normalement, pas ce qui se passe quand le prix saute. La borne de 10 % de
  l'exchange est celle de sa doc, mais n'a pas été mise à l'épreuve.
- **Un déclencheur limite**, au déclenchement.
- **Les routes du gateway** (`/orders/protective`, `/orders/batch-protective`) avec ce `p`.

## Ce que la doc officielle dit, et ne dit pas

Sources, relevées le 2026-10-16 :
[TP/SL](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/take-profit-and-stop-loss-orders-tp-sl#limit-vs-market-tp-sl-orders)
et [FAQ « My TP/SL did not execute correctly »](https://hyperliquid.gitbook.io/hyperliquid-docs/support/faq/trade-outcome-looks-incorrect/my-tp-sl-did-not-execute-correctly).

- Les TP/SL **au marché** ont une tolérance de glissement de **10 % par défaut**. La doc ne dit
  pas comment cette tolérance est transmise : l'historique du compte le dit, elle est recalculée
  par l'exchange.
- Elle donne un exemple de ce qui arrive quand le limite égale le déclencheur : un SL long avec
  déclencheur et limite à 10 $ peut **rester en attente** si le prix passe de 11 à 9. Cela vaut
  pour un déclencheur **limite**, où `p` compte ; les ordres au marché de ce compte, posés avec
  `p = triggerPx`, ont tous été exécutés.
- La page de l'endpoint `exchange` dit seulement « p is price ».

## Ce que les SDK disent (lu le 2026-10-18)

Lus par un outil qui en rend un résumé, pas ligne à ligne. Le détail est dans
`hyperliquid-mobile/docs/roadmap.md`, « À éprouver en réel », points 1 et 3. **Ces lectures ne
tranchaient rien** ; c'est l'historique du compte qui a tranché.

- **SDK Python officiel** : `basic_tpsl.py` envoie `p = triggerPx` pour le TP et un `p` écarté pour
  le SL ; `signing.py` écrit `p` pareil quelle que soit la valeur de `isMarket`.
- **SDK Rust communautaire (hypersdk)** : définit l'ordre déclencheur, n'en place aucun dans ses
  exemples, ne dit rien de `p`.
- **Issue `hyperliquid-python-sdk#97`** : un TP au marché exécuté a un `limitPx` à 90 % de celui
  de l'interface. Lue avec l'historique du compte, elle s'explique : c'est la borne de l'exchange.
