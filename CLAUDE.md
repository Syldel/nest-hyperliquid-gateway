# nest-hyperliquid-gateway — notes pour un agent

Passerelle interne entre le bot de trading (`nest-trading-bot`) et l'API Hyperliquid : elle
signe les actions, porte les routes et les DTO, et c'est la **seule** sortie du bot vers
Hyperliquid. Un seul utilisateur aujourd'hui, aucune stratégie activée.

Ce fichier est un point de départ, écrit le 2026-09-21 autour de la règle la plus coûteuse
à ignorer. Il reste à compléter.

## La règle qui coûte le plus cher si on l'ignore

**Tout appel à Hyperliquid passe par `executeInfo` ou `executeWithNonce`, jamais par un
`fetch` direct.** Ils portent le garde-fou de débit ; un appel qui les contourne n'est ni
compté ni freiné. Hyperliquid limite par IP sans documenter la sanction, et un bannissement
coupe le bot. Voir [docs/rate-limits.md](docs/rate-limits.md).

Ce qui en découle :

- **un 429 ne se relance jamais**, ni ici ni chez un client ;
- **rien de ce qui s'exécute au démarrage ne doit pouvoir faire planter le processus** : un
  hébergeur le relance aussitôt, et chaque relance rappelle Hyperliquid ;
- toute nouvelle boucle de relance est **bornée, espacée, et s'arrête sur un 429**.

## L'autre règle qu'on ne devine pas

**Un prix ou une taille mal écrits font refuser l'ordre, ou en font poser un autre.**
Hyperliquid impose `szDecimals` sur les tailles, et sur les prix 5 chiffres significatifs
et `MAX_DECIMALS - szDecimals` décimales — un prix entier échappant toujours aux chiffres
significatifs. Ces règles vivent dans **`@syldel/hl-shared-types`**, importées ici _et_ par le bot :
`ValueFormatterService` n'en est plus que la façade injectable. Deux implémentations, c'est
la garantie qu'un émetteur croira un jour avoir posé autre chose que ce qui l'a été. Voir
[docs/tick-and-lot-size.md](docs/tick-and-lot-size.md), y compris l'invariant du point fixe
et la décision de ne pas prendre de dépendance tierce ici — le gateway est le processus qui
signe.

## La troisième règle : un marché standard ne prédit pas un marché HIP-3

**Ne jamais supposer qu'une route rend la même chose pour un marché standard et pour un
marché HIP-3.** Ce gateway expose les routes ; c'est donc ici que l'écart se constate
d'abord, et ici qu'il doit être couvert. Tout flux fonctionnel sur les perpétuels — une
route, un champ, une unité, un arrondi, un cas d'absence — se vérifie sur **les deux**, et
les deux réponses se **comparent**.

Du constaté, pas de la prudence :

- le `coin` d'un marché HIP-3 porte un préfixe de dex (`xyz:BRENTOIL`, `xyz:MU`), un marché
  standard est nu (`BTC`, `ETH`). Tout ce qui indexe, parse, compare ou journalise par
  `coin` traverse deux formes — y compris un `split(':')` écrit pour l'une des deux ;
- les multiplicateurs de funding diffèrent par dex **et** par actif : 0,0 sur `flx` et
  `vntl`, 0,000001 sur `cash`, 0,01 à 1,0 sur `hyna`, 0,5 sur `xyz`. Un `"0.0"` rendu par
  `fundingHistory` a donc trois sens possibles — marché retiré, dex à multiplicateur nul,
  ou funding réellement nul ;
- HIP-3 utilise une formule de prime plus réactive, d'après la documentation officielle ;
- les paramètres ne se passent pas tous de la même façon selon la route : `fundingHistory`
  les attend **à plat**, `candleSnapshot` dans un `req` imbriqué. Une route nouvelle se lit,
  elle ne se déduit pas de la précédente.

Marchés d'épreuve : `BTC` et `ETH` d'un côté, `xyz:BRENTOIL` et `xyz:MU` de l'autre —
présents le 2026-10-08 (132 marchés sur le dex `xyz`, 234 en standard). La liste bouge :
vérifier qu'un marché cité existe encore avant de s'appuyer sur lui.

⚠️ Un appel de vérification reste un appel : espacer, compter le poids, et **ne jamais
relancer un 429** (voir la première règle).

## Travailler ici

- **Avant d'affirmer ce que l'exchange rend**, lire
  [docs/sources.md](docs/sources.md) : ce que la mesure, la doc officielle et les **SDK
  officiels** peuvent établir chacun, et pourquoi aucun ne remplace les autres. Les types de
  `@syldel/hl-shared-types` sont des affirmations sur l'API ; une affirmation fausse ne se
  voit pas, elle se paie plus tard.
- **Une page de documentation se lit en brut**, jamais à travers un outil qui résume : un
  résumé a déjà fait écrire une précision que le texte ne contient pas (2026-10-27). Comment
  s'y prendre, et ce qu'on écrit ensuite :
  [docs/sources.md](docs/sources.md#lire-une-page-de-documentation-en-brut).
- **Un TP/SL « de position »** (sans taille, au marché, groupe `positionTpsl`) a sa **propre
  famille de routes**, `/orders/position-protective` : aucune route existante ne l'accepte, et
  `formatSize` refuse toujours un zéro. Voir [docs/position-level-orders.md](docs/position-level-orders.md),
  y compris ce qui n'en est pas mesuré.
- **Ne jamais committer, tagger ou pousser sans demande explicite** : proposer un message
  de commit conventionnel, en anglais, et laisser l'utilisateur l'exécuter — comme dans les
  autres dépôts.
- **Le mode watch redémarre le gateway à chaque sauvegarde**, et chaque démarrage coûte
  ~260 de poids sur 1200 par minute. Grouper les modifications en une seule écriture.
  **Cela vaut pour tout ce qui écrit dans `src/`** : un test de mutation (écrire un fichier
  muté, le restaurer, vingt fois), un `prettier --write` global, des éditions en série. Le
  garde de débit est en mémoire et repart de zéro à chaque redémarrage : il ne voit pas
  cette salve. Avant d'écrire en boucle, **faire arrêter le watch** (ou travailler dans une
  copie hors du dossier surveillé). Le 2026-10-27, une boucle de 24 écritures a recompilé
  `dist/` — preuve d'un watch actif — sans qu'on sache combien de redémarrages en ont suivi.
- **Fins de ligne : LF partout**, imposé par `.gitattributes` (`* text=auto eol=lf`) et
  non par la configuration de la machine, comme dans `nest-trading-bot` et
  `trading-shared-types`. Prettier écrit en LF (`endOfLine`, explicite dans
  `.prettierrc`). Si un diff de fins de ligne réapparaît, vérifier d'abord
  `git config core.autocrlf`, qui doit valoir `false` dans ce dépôt. Si `git status`
  signale des fichiers que `git diff` montre identiques, c'est le cache de stat de
  l'index : `git add --renormalize .` le remet d'aplomb, sans rien committer.
- Commentaires en français, identifiants en anglais.
- Les règles eslint du dépôt s'appliquent aussi aux specs (`no-unsafe-*`) : typer les
  doubles plutôt que de passer par `any` (`as never` pour un argument sans intérêt).

## Vérifier avant d'annoncer

`npm run typecheck` (`tsc --noEmit`) couvre ce que `nest build` laisse de côté : son
`tsconfig.build.json` exclut `**/*spec.ts`, donc une erreur de type dans un spec pouvait y
vivre indéfiniment. Huit l'ont fait, et ts-jest n'en voyait qu'une partie — une suite verte
ne dit rien de ce que le compilateur refuse. Les deux se lancent, pas l'un ou l'autre.

## ⚠️ Connu et non traité

- `portfolioMargin` et `dexAbstraction` sont **refusés** plutôt que modélisés par
  `getCollateralBalance` (statut `unsupported-mode`). Le refus est éprouvé ; qu'il soit le
  bon comportement sur un vrai compte en portfolio margin ne l'est pas — ces deux modes
  n'ont jamais pu être exercés. Voir
  [docs/account-abstraction.md](docs/account-abstraction.md).
- Pour un déclencheur **au marché**, Hyperliquid **ignore le `p`** qu'on lui envoie : il recrée
  l'ordre au déclenchement avec sa propre borne de 10 % (mesuré le 2026-10-18 sur 26 ordres
  déclenchés d'un compte réel). Les ordres protecteurs (TP/SL, bot compris) partent donc, depuis
  cette date, avec cette borne dans `limitPx` (avant : `limitPx = triggerPx`) — sans effet sur
  l'exécution, pour que l'ordre au repos se lise comme l'ordre exécuté. Un déclencheur **limite**
  garde `p = triggerPx`, et là `p` compte : jamais observé au déclenchement. Non mesuré : un gap, et
  les routes du gateway elles-mêmes avec ce `p`. Voir
  [docs/protective-order-price.md](docs/protective-order-price.md).
