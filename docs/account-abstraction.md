# Mode d'abstraction de compte : où se lit le collatéral

## Pourquoi ce document

Le mode du compte décide **de quelle source vient le solde de collatéral**, et donc le
nombre qui dimensionne les ordres. Se tromper de source ne produit pas une erreur : ça
produit un autre chiffre, plausible, qui traverse tout le système sans rien déclencher.

## La règle, telle que la doc l'écrit

> Under **unified account or portfolio margin**, use spot balances endpoint instead for
> trading account balance across spot and perps.
>
> — doc Hyperliquid, `clearinghouseState`

Et, sur la page des modes :

> For API users, unified account and portfolio margin show all balances and holds in the
> spot clearinghouse state. **Individual perp dex user states are not meaningful.**

D'où le routage de `HyperliquidCollateralService.getCollateralBalance` :

| mode | marché perp | marché spot |
| ------------------------------- | ---------------------- | ------------- |
| `unifiedAccount`, `portfolioMargin` | soldes **spot** | soldes spot |
| tout autre mode | état **perp** du dex | soldes spot |

La branche cloisonnée est gardée par `hlPerpDexOf(asset) !== null`, et non par l'ancien
`isPerp` du registre : celui-ci valait `!isSpot && !isBuilder`, si bien qu'un marché HIP-3
n'était pas un perp et prenait la branche spot — précisément les dex dont le collatéral
n'est pas de l'USDC.

## ⚠️ Ce que `"default"` désigne n'est pas établi

La question a été ouverte un moment : `userAbstraction` rendait `"default"` sur le compte de
développement, et l'interface d'Hyperliquid présentait « Unified Account » comme recommandé.
Fallait-il lire `"default"` comme un synonyme d'unifié ?

**Non. Tranché le 2026-10-01 par une transition observée**, et c'est la seule preuve qui
compte — aucune lecture de documentation ne l'aurait remplacée.

Hyperliquid a présenté une modale : « The new default account type is Unified Account. I
acknowledge that spot and perps balances **will be** unified… ». Au futur, avec un bouton
*Accept*. Mesures encadrant le clic, sur `0x728430a0…7083`, en direct sur l'API publique :

| | avant *Accept* | après *Accept* |
| ------------------------- | ------------ | ----------------- |
| `userAbstraction` | `"default"` | **`"unifiedAccount"`** |
| `collateral-balance` BTC | `0.0` (état perp) | **`0.01079182`** (spot USDC) |

Les deux valeurs sont donc **distinctes**, et `"default"` désignait bien l'ancien défaut à
soldes séparés. La liste blanche (`unifiedAccount` et `portfolioMargin` seuls prennent la
branche spot) est correcte, et le basculement n'a demandé **aucune modification de code** :
la même condition a changé de source toute seule.

### Pourquoi la liste blanche, et pas une liste noire

Le sens de l'erreur n'est pas symétrique :

- un compte **unifié** lu comme cloisonné → on lit l'état perp → **moins** de capital →
  ordre sous-dimensionné ou refusé ;
- un compte **cloisonné** lu comme unifié → on lit le spot → **plus** de capital qu'il n'en
  est mobilisable → **ordre surdimensionné**.

Une valeur inconnue — un mode futur, une faute de frappe — doit donc tomber du côté
cloisonné. C'est ce que fait la liste blanche, et c'est la raison de la garder telle quelle.

### Ce que l'unification change, au-delà du chiffre

La modale le dit : « the **entire collateral balance** will go towards protecting against
cross margin liquidations ». En cloisonné, une perte sur un perp ne pouvait pas atteindre le
sac spot ; en unifié, elle le peut. Ce n'est pas qu'un changement de source de lecture,
c'est un changement de surface de risque — à garder en tête avant d'activer une stratégie.

Relevé juste après la bascule, les lignes spot se sont étoffées :
`USDC(0)`, `HYPE(150)`, `USDE(235)`, **`USDT0(268)`**, `USDH(360)`.

⚠️ Noter **`USDT0`**, et non `USDT`. L'appariement se fait par **index de token**, pas par
symbole : la table en dur qui cherchait `coin === 'USDT'` aurait manqué cette ligne. C'est la
justification rétrospective de ce choix.

## ⚠️ Le cache de mode aurait masqué cette bascule

`MODE_TTL` vaut 24 h, et la case est **unique** — contrairement à ses deux voisines, qui
sont des `Record` clés :

```ts
accountMode:  null as { value; expiresAt } | null,   // ← clé sur rien
perpState:    {} as Record<string, …>,               // clé `${isTestnet}-${dex}`
spotBalances: {} as Record<string, …>,               // clé `${isTestnet}`
```

Ce n'est plus une hypothèse : le 2026-10-01, le mode est passé de `"default"` à
`"unifiedAccount"` **pendant que le gateway tournait**, cache déjà rempli avec l'ancienne
valeur. Le gateway a pourtant rendu la nouvelle — parce qu'il tourne en mode veille et qu'une
édition de source l'avait redémarré entre-temps, donc **par accident**.

En production, rien ne l'aurait redémarré : le bot aurait continué à lire l'état perp
(`0.0`) au lieu des soldes spot (`0.01079182`) pendant **jusqu'à 24 h** après le changement,
sans qu'aucune erreur ne se déclenche. C'est exactement la défaillance muette que ce dépôt
refuse.

Trois corrections, par ordre d'urgence :

1. **clé sur l'utilisateur et le testnet**, comme les deux autres caches — sinon, à deux
   utilisateurs, le second hérite du mode du premier, et mainnet/testnet partagent la case ;
2. **TTL beaucoup plus court**, ou invalidation explicite : le mode change rarement, mais
   quand il change, tout le routage du collatéral change avec lui ;
3. à défaut, **journaliser tout changement de mode observé**, pour qu'un décalage se voie.

**À rouvrir** aussi si un ordre perp est refusé pour collatéral insuffisant alors que le spot
en porte.
