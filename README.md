# Hyperliquid API gateway

<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)[![ESLint](https://img.shields.io/badge/ESLint-4B32C3?style=for-the-badge&logo=eslint&logoColor=white)](https://eslint.org/)[![Jest](https://img.shields.io/badge/Jest-C21325?style=for-the-badge&logo=jest&logoColor=white)](https://jestjs.io/)[![NPM](https://img.shields.io/badge/NPM-CB3837?style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/)[![Markdown](https://img.shields.io/badge/Markdown-000000?style=for-the-badge&logo=markdown&logoColor=white)](https://www.markdownguide.org/)[![Prettier](https://img.shields.io/badge/Prettier-F7B93E?style=for-the-badge&logo=prettier&logoColor=black)](https://prettier.io/)

## Description


<p align="center">
    <a href="https://app.hyperliquid.xyz/" target="_blank"><img src="https://cdn.brandfetch.io/idGSMNVeGY/theme/light/idqNkDfpBl.svg?c=1bxid64Mup7aczewSAYMX&t=1762340635066" alt="Hyperliquid" height="120" /></a>
</p>

[Hyperliquid](https://app.hyperliquid.xyz/trade) Trade 100+ perps and spot assets on Hyperliquid, a decentralized Layer 1 blockchain with fully onchain order books.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Dépendances

Ce projet vise à minimiser au maximum le nombre de dépendances afin de réduire la complexité, la surface d’attaque et faciliter la maintenance.

Les dépendances sont volontairement limitées à :

- `@msgpack/msgpack` (requis par Hyperliquid),

- `@noble/hashes` pour les primitives cryptographiques,

- `ethers` pour les interactions Ethereum.

Pourquoi `ethers` ?

Bien que `@paulmillr/micro-eth-signer` soit une librairie très légère, `ethers` a été retenue pour :

- sa maturité et son usage éprouvé en production,

- une API stable et bien documentée,

- une meilleure intégration avec l’écosystème Ethereum,

- une réduction du code auxiliaire nécessaire à la gestion des signatures et des formats.

Ce choix permet de conserver un bon équilibre entre minimalisme, fiabilité et maintenabilité.

## Hyperliquid API (Agent Wallet)

Hyperliquid supporte les API wallets (agent wallets) permettant d’effectuer des actions au nom d’un compte sans permissions de retrait.
Les requêtes d’information utilisent toujours l’adresse publique du compte principal.

https://app.hyperliquid.xyz/API

### Configuration

À renseigner dans le fichier .env :
```env
JWT_USER_SECRET=
JWT_SERVICE_SECRET=
AGENT_ENCRYPTION_KEYS=2026-11:<64 hex>
NEST_USER_SERVICE_URL=http://localhost:3001
```

`AGENT_ENCRYPTION_KEYS` est le trousseau des clés maîtresses qui ouvrent les clés d'agent,
`kid:hex64` séparés par des virgules. Chaque clé d'agent est un JWE scellé par `set-agent-key`
(nest-mongo-user) sous un `kid` et pour un utilisateur (`hl-agent-key:<userId>`) : un `kid`
absent du trousseau, ou une clé recopiée sur un autre utilisateur, est refusé en le nommant.
Le trousseau est validé au démarrage, qui échoue s'il est absent ou malformé
(`@syldel/crypto-utils` ≥ 2.0.0, `JweUtil`). Pour changer de clé maîtresse : ajouter la
nouvelle au trousseau et redémarrer, relancer `set-agent-key` avec le nouveau `kid`, puis
retirer l'ancienne.

### L'agent qui signe : refusé avant toute signature

Depuis le 2026-11-05, `agent-credentials` (nest-mongo-user) sert avec la clé les données
publiques de l'agent : adresse, nom, expiration (`validUntil`), déclarées par `set-agent-key`
(voir `nest-mongo-user/docs/agent-key.md`). `executeWithNonce`, par où passe toute action
`/exchange`, refuse de signer en **HTTP 412**, avant tout nonce, signature ou requête :

- quand la clé est celle du **wallet maître** de l'utilisateur, ou sans wallet connecté à
  comparer : elle signerait avec des pouvoirs qu'un agent n'a pas (retraits, transferts) ;
- sans données d'agent (une clé enregistrée avant ce changement) : relancer `set-agent-key` ;
- quand l'adresse de la clé déchiffrée n'est pas l'adresse déclarée ;
- à partir de l'instant `validUntil`, contrôlé à chaque action et non au chargement : une
  entrée du cache vit sept jours.

Chaque réponse `status: "err"` de l'exchange est journalisée avec l'adresse et le nom de
l'agent qui a signé, et le texte de la réponse (tronqué à 300 caractères) ; jamais la
requête. Un rafraîchissement du cache refusé (`/internal/sync`) **vide** l'entrée au lieu de
garder l'ancienne clé. `approveAgent`, qui signait avec la clé d'agent alors que Hyperliquid
exige le wallet maître, a été retiré. `WalletService` ne garde plus le dernier `Wallet`
construit : jusqu'au 2026-11-05, ce singleton laissait la clé en clair en mémoire jusqu'à
l'arrêt du gateway, au-delà de toute rotation.

## API using

### curl JSON pretty-print
Méthode universelle pour afficher un JSON bien formaté (ou "pretty-print") avec curl.
```
curl https://api.exemple.com/data | python -m json.tool
```
Note : Si votre commande python s'appelle python3, remplacez python par python3.
Note : Il existe aussi jq

### Hyperliquid
Get Hyperliquid Spot balance
```
curl http://localhost:3000/hyperliquid/account/spot/0x2a364d15d2072636025e4d69fdcf2cf29815e3e0
```
