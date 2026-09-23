# Prix et tailles : ce qu'Hyperliquid accepte

## Pourquoi ce document existe

Un prix ou une taille mal écrits ne sont pas une coquetterie de format : Hyperliquid
**refuse** l'ordre, ou en accepte une version tronquée qui n'est plus celle qu'on voulait.
Sur un stop loss, la différence entre les deux, c'est une position protégée et une position
qui ne l'est pas.

## Les règles

Source : [Tick and lot size](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-and-lot-size)
et [Notation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/notation),
relevées le 2026-09-23.

`szDecimals` est propre à chaque actif et se lit dans la réponse `meta` de `/info`.

### Tailles (`sz`)

Tronquées à `szDecimals`. Si `szDecimals = 3`, `1.001` est valide, `1.0001` ne l'est pas.
La taille est exprimée **en unités de la devise de base** (`Sz`), pas en USD — le notionnel,
c'est `Ntl = Px * Sz`.

### Prix (`px`)

Deux plafonds, cumulatifs :

1. **au plus 5 chiffres significatifs** ;
2. **au plus `MAX_DECIMALS - szDecimals` décimales**, avec `MAX_DECIMALS` = 6 en perp et 8 en
   spot.

**Un prix entier est toujours accepté**, quel que soit son nombre de chiffres significatifs.
`123456` est valide là où `12345.6` ne l'est pas.

| Marché | Prix | `szDecimals` | Verdict |
| --- | --- | --- | --- |
| perp | `1234.5` | — | valide |
| perp | `1234.56` | — | refusé (6 chiffres significatifs) |
| perp | `0.001234` | 0 | valide |
| perp | `0.0012345` | 0 | refusé (plus de 6 décimales) |
| perp | `0.01234` | 1 | valide |
| perp | `0.012345` | 1 | refusé (plus de 6 − 1 décimales) |
| spot | `0.0001234` | 0 ou 1 | valide |
| spot | `0.0001234` | 3 | refusé (plus de 8 − 3 décimales) |

## Où vivent ces règles, et pourquoi pas ici

Dans **`@syldel/hl-shared-types`** (`format/tick-and-lot.ts`), importées par le gateway *et*
par le bot de trading. `ValueFormatterService` n'en est plus que la façade injectable.

Ce n'est pas un rangement : c'est la correction d'un défaut. Tant que le gateway avait sa
règle et le bot la sienne, le bot pouvait envoyer une valeur que le gateway raccourcissait
**sans le dire** — le bot croyait alors avoir posé un prix qui ne l'était pas, et son
contrôle de cohérence réclamait un réalignement à chaque passage. Mesuré le 2026-09-23 :
le bot envoyait `12.3456`, le gateway posait `12.345`. Détail dans
`nest-trading-bot/docs/known-gaps.md`, « Prix et tailles : trois défauts de formatage ».

**L'invariant qui l'empêche de revenir** :

> Ce qu'un émetteur envoie doit être un **point fixe** du formateur :
> `formatPrice(x) === x`. Sinon il ignore ce qu'il a posé.

`snapPrice(price, szDecimals, type, mode)` sert précisément à ça : il pose un prix sur la
grille **dans un sens choisi** et garantit le point fixe, là où `formatPrice` tronque
toujours. Un émetteur qui veut qu'un stop ne s'éloigne jamais de son ancre en a besoin.

Trois points à retenir sur l'implémentation :

- **tronquer, pas arrondir** — un prix de `12.3456` devient `12.345`, jamais `12.346` ;
- **rien ne passe par `Number`** : tout le calcul se fait sur les chiffres écrits, en
  `BigInt`. Un `parseFloat` réintroduirait l'erreur d'arrondi que ces règles servent à
  éviter ;
- **une chaîne qui n'est pas un décimal simple est refusée**, notation scientifique
  comprise. Un `number` en revanche est une valeur *calculée* : il est écrit exactement,
  exposant déplié. Un émetteur ne doit jamais fabriquer une taille par
  `Number(...).toString()`, qui rend `1e-7` pour `0.0000001`.

Éprouvé par `test/tick-and-lot.spec.ts` dans `hl-shared-types`, sur **tous** les exemples de
la documentation, plus ceux de l'oracle ci-dessous.

## Un écart assumé sur l'exemption des entiers

Au-delà de 99 999 avec une partie fractionnaire, deux implémentations de référence — celle
du gateway avant le 2026-09-23, et [nktkas/hyperliquid](https://github.com/nktkas/hyperliquid/blob/main/src/utils/_format.ts) —
appliquent les 5 chiffres significatifs **avant** de constater que le résultat tronqué est
entier : `123456.7` y devient `123450`.

La documentation dit « Integer prices are always allowed, regardless of the number of
significant figures ». `123456` est donc valide, et perd 6 $ de moins. C'est ce que fait
l'implémentation partagée.

Le même changement corrigeait un vrai défaut du gateway : il testait l'exemption sur
**l'écriture d'entrée** plutôt que sur la valeur, si bien que `'123456'` rendait `123456`
mais `'123456.0'` rendait `123450` — la même valeur, écrite autrement. Or Hyperliquid écrit
justement ses prix entiers avec un `.0`.

⚠️ **Non vérifié sur le vrai exchange** : cela demande de passer un ordre. À confirmer lors
d'un prochain test en conditions réelles du bot. Le mode d'échec serait bruyant — un ordre
refusé, pas un ordre posé de travers.

## Une implémentation tierce, comme oracle et non comme dépendance

`@nktkas/hyperliquid` implémente ces mêmes règles. Elle a été **lue** le 2026-09-23, jamais
installée, et c'est délibéré :

- **le gateway est le processus qui signe.** Une librairie de formatage assise à côté de la
  clé, mise à jour automatiquement, est la cible la plus rentable de tout le système. Pour
  deux fonctions, et `decimal.js` avec elles, le ratio est mauvais ;
- **les trois conditions sous lesquelles posséder son code bat en dépendre sont réunies** :
  c'est petit (~250 lignes avec les commentaires), c'est figé (le jour où l'API v1 changera
  la notation, il faudra relire la règle de toute façon), et c'est entièrement spécifié donc
  testable ;
- une librairie abandonnée, c'est un fork à faire plus tard, en urgence, sur du code qu'on
  n'a jamais lu.

**Mais posséder oblige.** Ce qui rend l'autonomie sûre, ce n'est pas d'écrire le code, c'est
de prouver sa conformité en continu. D'où la méthode : quand la documentation bouge ou qu'un
doute surgit, on **relit** une implémentation tierce et on **date la confrontation**. Celle
du 2026-09-23 a révélé le défaut de l'exemption des entiers en dix minutes, sans installer
une ligne.

⚠️ Un faux gateway de test, lui, garde une **copie indépendante** de ces règles
(`nest-trading-bot/src/hyperliquid/testing/gateway-contract.ts`). S'il importait
l'implémentation partagée, un défaut s'y annulerait des deux côtés et aucun test ne le
verrait.

## Ce que ça implique en aval

Le gateway garantit qu'un ordre **part** conforme, et ne dit pas ce qu'il a changé. Deux
conséquences, vérifiées le 2026-09-22 :

1. **Une valeur tronquée n'est pas signalée en retour.** Le consommateur qui a demandé
   `0.002325` sur un actif à 5 décimales voit poser `0.00232` ; le reliquat n'existe que dans
   son propre décompte. Le bot lit désormais `origSz` et `sz` dans la réponse plutôt que de
   recalculer, et journalise un écart entre demandé et posé.
2. **Deux écritures d'un même prix ne sont pas le même texte.** `isSameProtectiveOrder`
   (`smart-order.service.ts`) comparait prix et tailles **en chaînes** : la demande passait
   par `formatPrice` (`1103`) quand l'existant gardait l'écriture d'Hyperliquid (`1103.0`),
   et un ordre inchangé était modifié pour rien, avec un nouvel oid. **Corrigé le
   2026-09-23** : les deux côtés sont réécrits dans la même forme canonique avant comparaison
   (`canonicalOrRaw`).

## Quand ce document doit changer

Hyperliquid annonce une API v1 qui normalisera cette notation (`px`, `sz`, `szi`, `ntl`,
`tif`…). Le jour où elle arrive, ces règles et les tables ci-dessus sont à relire, pas à
supposer stables.
