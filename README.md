# Hyperliquid API gateway

<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

<p align="left">
  <a href="https://www.typescriptlang.org/" target="_blank">
    <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" height="30" />
  </a>
  <a href="https://nodejs.org/" target="_blank">
    <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="NodeJS" height="30" />
  </a>
  <a href="https://eslint.org/" target="_blank">
    <img src="https://img.shields.io/badge/ESLint-4B32C3?style=for-the-badge&logo=eslint&logoColor=white" alt="ESLint" height="30" />
  </a>
  <a href="https://jestjs.io/" target="_blank">
    <img src="https://img.shields.io/badge/Jest-C21325?style=for-the-badge&logo=jest&logoColor=white" alt="Jest" height="30" />
  </a>
  <a href="https://www.npmjs.com/" target="_blank">
    <img src="https://img.shields.io/badge/NPM-CB3837?style=for-the-badge&logo=npm&logoColor=white" alt="NPM" height="30" />
  </a>
  <a href="https://www.markdownguide.org/" target="_blank">
    <img src="https://img.shields.io/badge/Markdown-000000?style=for-the-badge&logo=markdown&logoColor=white" alt="Markdown" height="30" />
  </a>
  <a href="https://prettier.io/" target="_blank">
    <img src="https://img.shields.io/badge/Prettier-F7B93E?style=for-the-badge&logo=prettier&logoColor=black" alt="Prettier" height="30" />
  </a>
</p>


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
AGENT_ENCRYPTION_SECRET=
NEST_USER_SERVICE_URL=http://localhost:3001
```

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
