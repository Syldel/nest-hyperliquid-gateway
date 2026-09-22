# Prix et tailles : ce qu'Hyperliquid accepte

## Pourquoi ce document existe

Un prix ou une taille mal écrits ne sont pas une coquette de format : Hyperliquid **refuse**
l'ordre, ou en accepte une version tronquée qui n'est plus celle qu'on voulait. Sur un stop
loss, la différence entre les deux, c'est une position protégée et une position qui ne l'est
pas.

Ce gateway est la **seule** sortie vers Hyperliquid. C'est donc ici, et nulle part ailleurs,
que ces règles s'appliquent — un consommateur (le bot de trading, l'app) peut calculer ce
qu'il veut, `ValueFormatterService` est le dernier mot avant l'envoi.

⚠️ Corollaire pour les consommateurs : **ce que vous envoyez n'est pas forcément ce qui est
posé.** Le gateway tronque sans le dire. Un consommateur qui compare ensuite « ce que j'ai
demandé » à « ce que l'exchange détient » doit comparer des **valeurs**, pas des écritures,
et prévoir que la sienne ait été raccourcie. Voir [Ce que ça implique en
aval](#ce-que-ça-implique-en-aval).

## Les règles

Source : [Tick and lot size](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-and-lot-size)
et [Notation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/notation),
relevés le 2026-09-22.

`szDecimals` est propre à chaque actif et se lit dans la réponse `meta` de `/info`.

### Tailles (`sz`)

Arrondies à `szDecimals`. Si `szDecimals = 3`, `1.001` est valide, `1.0001` ne l'est pas.

La taille est exprimée **en unités de la devise de base** (`Sz`), pas en USD — le notionnel,
c'est `Ntl = Px * Sz`.

### Prix (`px`)

Deux plafonds, cumulatifs :

1. **au plus 5 chiffres significatifs** ;
2. **au plus `MAX_DECIMALS - szDecimals` décimales**, avec `MAX_DECIMALS` = 6 en perp et 8 en
   spot.

**Un prix entier est toujours accepté**, quel que soit son nombre de chiffres significatifs.
`123456` est valide là où `12345.6` ne l'est pas.

Exemples de la documentation :

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

## Ce que le gateway en fait

`ValueFormatterService` (`src/hyperliquid/services/value-formatter.service.ts`), appelé par
`convertToApiOrder` pour **tout** ordre sortant.

- `formatSize(size, szDecimals)` : **tronque** à `szDecimals`. Lève une `RangeError` si la
  troncature donne 0 — une taille trop petite est refusée, jamais envoyée à zéro.
- `formatPrice(price, szDecimals, type)` : laisse passer un entier tel quel, sinon applique
  d'abord la limite de décimales, **puis** celle des 5 chiffres significatifs. Lève une
  `RangeError` si le résultat vaut 0.

Trois points à retenir :

- **tronquer, pas arrondir.** `toFixedTruncate` et `toPrecisionTruncate` coupent. Un prix de
  `12.3456` devient `12.345`, jamais `12.346` ;
- **rien ne passe par `Number`.** Tout le calcul est fait sur les chiffres écrits
  (`StringMath`), parce qu'un `parseFloat` réintroduirait exactement l'erreur d'arrondi que
  ces règles servent à éviter ;
- **une chaîne qui n'est pas un décimal simple est refusée** (`assertNumberString`) : la
  notation scientifique comprise. `1e-7` lève une `TypeError`, donc un 500 — et, sur une
  écriture, un ordre dont le consommateur ne saura pas s'il est passé. Un consommateur ne
  doit jamais construire une taille par `Number(...).toString()`, qui produit `1e-7` pour
  `0.0000001`.

Éprouvé par `value-formatter.service.spec.ts`, y compris sur les prix et tailles minimaux de
référence des perps et des spots.

## Ce que ça implique en aval

Le gateway garantit qu'un ordre **part** conforme. Il ne garantit pas que le consommateur
sache ce qui est parti. Deux conséquences, vérifiées le 2026-09-22 :

1. **Une valeur tronquée n'est pas signalée en retour.** Le consommateur qui a demandé
   `0.002325` sur un actif à 5 décimales voit poser `0.00232` ; le reliquat n'existe que
   dans son propre décompte. Le bot de trading lit désormais `origSz` et `sz` dans la
   réponse plutôt que de recalculer, et journalise un écart entre demandé et posé.
2. **Deux écritures d'un même prix ne sont pas le même texte.** `isSameProtectiveOrder`
   (`smart-order.service.ts`) compare prix et tailles **en chaînes** : la demande passe par
   `formatPrice` (`1103`) quand l'existant garde l'écriture d'Hyperliquid, qui ajoute une
   décimale à un prix entier (`1103.0`). Un ordre inchangé est donc modifié pour rien. ⚠️
   Défaut ouvert, signalé dans le code ; voir
   `nest-trading-bot/docs/known-gaps.md`, « Le gateway modifie une protection inchangée ».

## Quand ce document doit changer

Hyperliquid annonce une API v1 qui normalisera cette notation (`px`, `sz`, `szi`, `ntl`,
`tif`…). Le jour où elle arrive, ces règles et les tables ci-dessus sont à relire, pas à
supposer stables.
