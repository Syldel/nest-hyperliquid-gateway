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

## Travailler ici

- **Ne jamais committer, tagger ou pousser sans demande explicite** : proposer un message
  de commit conventionnel, en anglais, et laisser l'utilisateur l'exécuter — comme dans les
  autres dépôts.
- **Le mode watch redémarre le gateway à chaque sauvegarde**, et chaque démarrage coûte
  ~260 de poids sur 1200 par minute. Grouper les modifications en une seule écriture.
- **Fins de ligne** : ce dépôt n'a pas encore de `.gitattributes` et hérite de
  `core.autocrlf=true` (défaut de Git for Windows) ; les fichiers sont en CRLF sur disque.
  Ne pas lancer `npm run format` sur tout `src/` : il réécrirait chaque fichier en LF.
  Formater seulement les fichiers touchés, avec `--end-of-line crlf` pour ceux qui
  existent. À aligner sur `nest-trading-bot`, qui a réglé le sujet (voir son `CLAUDE.md`,
  « Fins de ligne »).
- Commentaires en français, identifiants en anglais.
- Les règles eslint du dépôt s'appliquent aussi aux specs (`no-unsafe-*`) : typer les
  doubles plutôt que de passer par `any` (`as never` pour un argument sans intérêt).

## ⚠️ Connu et non traité

- `npx tsc -p tsconfig.json --noEmit` échoue sur `smart-order.service.spec.ts` : la
  signature de `resolveQuoteFromPercent` a gagné un paramètre `asset` (commit `078c6a3`)
  sans que le spec suive. Le build de production (`tsconfig.build.json`) est propre, et jest
  passe (il ne vérifie pas les types).
