# Ordres protecteurs : le prix limite `p` d'un déclencheur « au marché »

## Pourquoi ce document existe

⚠️ **Défaut possible, non mesuré.** Un stop loss est la seule chose qui sépare une position
d'une perte non bornée ; un stop qui se déclenche sans s'exécuter est pire qu'une erreur
visible, car rien ne le signale. Cette page garde la question ouverte là où quelqu'un la
lira avant de confier de l'argent réel à un SL.

## Ce que fait le gateway aujourd'hui

`SmartOrderService.toHLOrderDetails` (`src/hyperliquid/services/smart-order.service.ts`)
construit tout ordre protecteur — Take Profit ou Stop Loss, y compris ceux du bot — avec

```
limitPx = triggerPx        // le même prix, aux deux endroits
trigger: { isMarket: true (par défaut), triggerPx, tpsl }
```

`limitPx` part tel quel dans le champ `p` de l'ordre (`hyperliquid-api-trade.service.ts`).
Le champ est **obligatoire** : le DTO le refuse absent (`@IsString() limitPx`).

## Pourquoi c'est une question

Sources, relevées le 2026-10-16 :
[TP/SL](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/take-profit-and-stop-loss-orders-tp-sl#limit-vs-market-tp-sl-orders)
et [FAQ « My TP/SL did not execute correctly »](https://hyperliquid.gitbook.io/hyperliquid-docs/support/faq/trade-outcome-looks-incorrect/my-tp-sl-did-not-execute-correctly).

- Les TP/SL **au marché** ont une tolérance de glissement de **10 % par défaut**. La doc
  ne dit pas comment cette tolérance est transmise : très probablement par `p`, calculé par
  l'interface officielle à 10 % du déclencheur. **Ce n'est pas écrit.**
- La doc donne un exemple de ce qui arrive quand le limite égale le déclencheur : un SL long
  avec déclencheur et limite à 10 $ peut **rester en attente** si le prix passe de 11 à 9 ;
  un limite à 8 $ s'exécute entre 9 et 8.
- Si `p` borne un déclencheur « au marché », un SL vendeur envoyé avec `p = triggerPx` est
  exactement ce cas : il ne s'exécute pas dans un gap sous son déclencheur.

La page de l'endpoint `exchange` dit seulement « p is price » ; elle ne dit pas si `p` est
appliqué ou ignoré quand `isMarket` vaut `true`.

## Ce qui reste à établir, en réel (petite taille ou testnet)

1. Un SL vendeur au marché avec `p = triggerPx` : se remplit-il quand le prix **traverse**
   le déclencheur sans s'y arrêter ? (Mesurable sur un actif peu liquide ou un
   déclencheur très proche du marché.)
2. Le même ordre avec `p` à 10 % du déclencheur : même observation.
3. Si les deux se comportent pareil, `p` est ignoré pour un déclencheur au marché et
   `p = triggerPx` est inoffensif. Sinon, il faut envoyer un `p` à la tolérance voulue, avec le
   sens correct (plus bas pour une vente, plus haut pour un achat), et décider qui choisit
   l'écart : l'appelant (bot, mobile) ou le gateway.

Tant que ce n'est pas mesuré, **ne pas considérer un SL protecteur comme garanti
d'exécution**. Le même constat est tenu côté application, dans
`hyperliquid-mobile/docs/roadmap.md`, « À éprouver en réel ».
