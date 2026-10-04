# Sur quoi s'appuyer pour décider d'un modèle de données

Ce dépôt traduit l'API d'Hyperliquid en types partagés (`@syldel/hl-shared-types`) que le
bot et l'application mobile consomment. Chaque champ déclaré ici est une **affirmation sur
ce que l'exchange rend**, et une affirmation fausse ne se voit pas : elle se paie plus tard,
sur un dimensionnement ou un affichage.

Ce document dit où chercher avant d'affirmer, et ce que chaque source peut ou ne peut pas
établir.

## Trois sources, et ce que chacune prouve

Elles ne forment pas une hiérarchie où la meilleure remplacerait les autres : **elles
couvrent des terrains différents**, et la bonne question est « laquelle peut trancher
*ceci* ? ».

### 1. La mesure de première main

Captures du gateway (`nest-trading-bot/captures/`, variable `GATEWAY_CAPTURE_FILE`),
lectures via les routes `/hyperliquid/info/*`, relevés dans le navigateur.

- **Prouve** qu'une forme existe, et c'est la seule source qui le fasse. Un `null` observé
  une fois clôt la question de la nullité d'un champ.
- **Ne prouve pas** l'inverse : mille valeurs présentes n'établissent pas qu'un champ soit
  toujours là. L'asymétrie est totale, et c'est elle qui décide du sens dans lequel on peut
  conclure.
- **Se décrit honnêtement.** « 22 entrées » n'est pas « 22 observations » si ce sont 22
  instantanés de la même position : noter le nombre d'**états distincts**, le ou les coins,
  le ou les dex, et les modes couverts. Un échantillon d'une paire sur un dex HIP-3 ne dit
  rien du dex principal.

### 2. La documentation officielle

<https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api>

- **Fait autorité** sur les noms de champs, les types de requête et le chemin nominal.
- **Est construite sur un exemple par endpoint**, donc muette sur ce qui *varie*. Deux cas
  rencontrés : `liquidationPx` n'y apparaît qu'en chaîne alors qu'il peut valoir `null` ;
  `collateralToken` est absent de l'exemple de `meta` mais présent dans celui de
  `metaAndAssetCtxs`, pour un champ que les cinq dex rendent.
- Un champ absent d'un exemple n'est donc **ni absent de l'API, ni optionnel**.

### 3. Le SDK Python officiel

Première partie, et **typé** — ce que la doc en prose n'est pas :

[`hyperliquid-dex/hyperliquid-python-sdk`](https://github.com/hyperliquid-dex/hyperliquid-python-sdk),
`hyperliquid/utils/types.py` : des `TypedDict`, des `Union`, des `Literal`, des `Optional`.
C'est le seul SDK que la page d'API de la documentation présente comme le sien.

- **Tranche les questions de forme** que la doc laisse en suspens : unions discriminées,
  champs propres à une variante, valeurs énumérées, nullité. C'est de l'information de
  première partie, exprimée dans le registre exact dont on a besoin ici.
- **Est particulièrement utile quand la mesure est étroite** : il couvre les branches qu'un
  compte de développement n'a jamais exercées.

### Ce qui *ressemble* à une source officielle sans l'être

La page d'API renvoie aussi vers des bibliothèques **écrites par la communauté**, et le dit :
un SDK Rust (`infinitefield/hypersdk`), deux SDK TypeScript (`nktkas/hyperliquid`,
`nomeida/hyperliquid`), et les intégrations CCXT. Il n'existe donc **aucun SDK TypeScript de
première partie**.

**Être lié par la documentation officielle n'est pas être de première partie.** Le lien
donne de la visibilité, pas de l'autorité : ces projets lisent la même API que nous et
peuvent s'être trompés de la même façon. Ils servent à **repérer** une question — « celui-là
déclare ce champ nullable, pourquoi ? » — jamais à la clore.

Le piège est le SDK TypeScript : même langage, même système de types, on a envie d'y recopier
une union toute faite. C'est précisément celui à ne pas croire sur parole.

Un dépôt de l'organisation `hyperliquid-dex` n'est pas non plus un blanc-seing. Relevé le
2026-10-04, par appel direct à l'API GitHub sur chaque dépôt :

| dépôt | dernier `push` | ce qu'en dit la doc d'API |
| --- | --- | --- |
| `hyperliquid-python-sdk` | 2026-06-04 | présenté comme le SDK Python |
| `hyperliquid-rust-sdk` | **2025-10-21** | **pas mentionné** — la doc renvoie au SDK communautaire |

Onze mois sans écriture, et la documentation qui oriente ailleurs : c'est le risque
« un client retarde sur le serveur » rendu concret. Ce dépôt se lit comme un indice, pas
comme une référence.

⚠️ Et sur la méthode : un relevé de l'organisation entière, résumé par un outil, s'est
révélé faux sur ce dépôt (donné comme un *fork* Python, alors que l'API dit `fork: false` et
`description: null`). **Interroger chaque dépôt séparément**, et citer le champ lu.

## Le cas qui a fait écrire ce document

`HLPerpLeverage` déclarait `rawUsd` **obligatoire** pour les deux modes de marge. Le faux
gateway du bot devait donc forcer une assertion de type pour construire une position cross
plausible — ce qu'un double n'a pas le droit de faire.

Aucune des deux premières sources ne pouvait trancher :

- les captures ne contenaient que des leviers `cross`, tous en `{ type, value }` nus, sur
  **une seule paire** d'un seul dex : rien sur l'isolé ;
- l'exemple de la doc de `clearinghouseState` ne montre qu'une position **isolée**, qui
  porte `rawUsd` : rien sur le cross.

Le SDK Python déclare les deux, et l'affaire est close :

```python
CrossLeverage    = TypedDict("CrossLeverage",    {"type": Literal["cross"],    "value": int})
IsolatedLeverage = TypedDict("IsolatedLeverage", {"type": Literal["isolated"], "value": int,
                                                  "rawUsd": str})
Leverage = Union[CrossLeverage, IsolatedLeverage]
```

C'est la forme qu'a prise `HLPerpLeverage` en 0.0.23 — union discriminée sur `type`, et non
`rawUsd?: DecimalString`, parce qu'un optionnel rendrait le champ lisible sans vérifier le
mode et que `Number(undefined)` rend `NaN` sans un mot.

## Ce que le SDK Python ne règle pas

Il est de première partie, pas infaillible, et le citer ne dispense pas de mesurer :

- **C'est un client.** Il peut retarder sur le serveur, ou ne couvrir que ce dont il a
  besoin. Un `Literal[...]` dit ce que le SDK accepte, pas nécessairement tout ce que
  l'exchange émet.
- **Il ne type pas tout.** Relevé le 2026-10-04 : `types.py` déclare `Leverage` mais
  **aucun** type de position — ni `liquidationPx`, ni `entryPx`, ni `assetPositions`. Son
  silence n'est pas une réponse.
- **Il ne dit rien de l'état d'un compte.** « Ce dex rend-il `collateralToken` ? », « ce
  marché est-il délisté ? », « mon compte est-il unifié ? » sont des questions de mesure.
- **Les conventions diffèrent.** Python écrit `int` là où TypeScript n'a que `number` ; les
  décimaux voyagent en `str`, ce que `DecimalString` traduit. Ne pas recopier un type, en
  lire la **structure**.

## La règle qui précède les trois

**Seules les sources de première partie concluent** : l'exchange, sa documentation, son SDK
Python, et la mesure. Les sites agrégateurs, billets de blog et réponses d'assistants
conversationnels ne sont pas conservés, même quand ils tombent juste — on ne peut pas
distinguer après coup ce qu'ils ont vérifié de ce qu'ils ont supposé, et une affirmation
dont on ne peut plus remonter l'origine n'est pas une source.

Le reste — SDK communautaires, CCXT, dépôts de l'organisation que la doc n'appuie plus —
**ouvre** des questions sans les clore. C'est utile : une divergence entre deux
implémentations signale l'endroit exact où aller mesurer. Mais la conclusion se tire
ailleurs, et le commentaire qui en naît cite la source qui a tranché, pas celle qui a
alerté.

Et dans tous les cas : **citer où et quand**. Un chemin de fichier dans un SDK, un endpoint
et une date de relevé, le nombre d'états distincts observés. C'est ce qui permet à la
personne suivante de contredire la conclusion au lieu de devoir la refaire.
