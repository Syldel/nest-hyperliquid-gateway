# Ordres protecteurs : le prix limite `p` d'un déclencheur « au marché »

## Pourquoi ce document existe

⚠️ **Défaut possible, non mesuré.** Un stop loss est la seule chose qui sépare une position
d'une perte non bornée ; un stop qui se déclenche sans s'exécuter est pire qu'une erreur
visible, car rien ne le signale. Cette page garde la question ouverte là où quelqu'un la
lira avant de confier de l'argent réel à un SL.

## Ce que fait le gateway (depuis le 2026-10-18)

`SmartOrderService.toHLOrderDetails` (`src/hyperliquid/services/smart-order.service.ts`)
construit tout ordre protecteur — Take Profit ou Stop Loss, y compris ceux du bot — avec

```
limitPx = triggerPx × 0,9   // vente (ferme un long), × 1,1 pour un achat, arrondi comme l'exchange l'exige
trigger: { isMarket: true (par défaut), triggerPx, tpsl }
```

`limitPx` part tel quel dans le champ `p` de l'ordre (`hyperliquid-api-trade.service.ts`).
Le champ est **obligatoire** : le DTO le refuse absent (`@IsString() limitPx`).

**Avant le 2026-10-18**, `limitPx` valait `triggerPx`. Le changement ne tranche pas la
question ci-dessous : il rend la réponse sans importance (voir « Pourquoi 10 % »). Un
déclencheur **limite** (`isMarket: false`) garde `p = triggerPx` : l'appelant ne donne qu'un
prix, et aucun appelant connu ne l'utilise.

**Pourquoi 10 %.** Un `p` écarté est sûr dans les deux hypothèses : si `p` est ignoré pour un
déclencheur au marché, il ne change rien ; s'il borne l'exécution, il laisse le stop sortir
dans un gap. 10 % est la tolérance de glissement par défaut de l'interface officielle, et ce
que le formulaire d'ordre du mobile envoie pour un déclencheur au marché. La modale « Add
protective order » du mobile gardait, elle, un écart fixe de 0,1 % jusqu'au 2026-10-18 ; elle
suit désormais les mêmes écarts. **C'est un choix, pas une mesure**, comme les autres écarts
du formulaire.

⚠️ **Non mesuré** : ce que `frontendOpenOrders` rend dans `limitPx` pour un ordre posé ainsi.
L'issue `hyperliquid-python-sdk#97` rapporte un `limitPx` renvoyé à 90 % de celui de
l'interface pour un TP au marché exécuté. Le bot lit donc le **déclencheur** d'un ordre
déclenché, jamais sa limite, pour juger un ordre existant. Pour cette raison, la comparaison
« cet ordre a-t-il changé ? » (`filterUnchangedOrders`) ne porte **pas** sur `p` : un écart
entre ce qu'on envoie et ce qu'on lit relancerait une modification à chaque passage. Les
protections déjà posées avant le changement gardent donc `p = triggerPx` tant que leur
déclencheur ne bouge pas.

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

## Ce que les SDK disent (lu le 2026-10-18)

Lus par un outil qui en rend un résumé, pas ligne à ligne : à reconfirmer sur le dépôt avant
d'en faire une règle. Le détail et la valeur de chaque source sont dans
`hyperliquid-mobile/docs/roadmap.md`, « À éprouver en réel », points 1 et 3.

- **SDK Python officiel** : l'exemple `basic_tpsl.py` envoie `p = triggerPx` pour le TP, mais un
  `p` écarté du déclencheur pour le SL. `signing.py` écrit `p` pareil quelle que soit la valeur
  de `isMarket` : l'effet de `p` est celui de l'exchange, jamais décidé par le SDK.
- **SDK Rust communautaire (hypersdk)** : définit l'ordre déclencheur, n'en place aucun dans ses
  exemples, ne dit rien de `p`.
- **Issue `hyperliquid-python-sdk#97`** : un TP au marché exécuté a un `limitPx` à 90 % de celui
  de l'interface. Un indice (un cas, un tiers), pas une preuve.

**Ce que cela établit : rien sur l'effet de `p`.** Ce que cela laisse sûr : un `p` écarté du
déclencheur est la pratique de l'exemple officiel pour un SL, donc `p = triggerPx` n'est pas le
seul usage prévu.
