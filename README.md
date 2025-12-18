# Hyperliquid API gateway

<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

<p align="left"><a href="https://www.typescriptlang.org/" target="_blank"><img src="https://raw.githubusercontent.com/jpb06/jpb06/master/icons/TypeScript.svg" alt="TypeScript" height="60" /></a><a href="https://nodejs.org/en/docs/" target="_blank"><img height="60" src="https://raw.githubusercontent.com/jpb06/jpb06/master/icons/NodeJS-Dark.svg" /></a><a href="https://eslint.org/" target="_blank"><img src="https://raw.githubusercontent.com/jpb06/jpb06/master/icons/Eslint-Dark.svg" alt="eslint" width="60" height="60"/></a><a href="https://jestjs.io/" target="_blank"><img src="https://raw.githubusercontent.com/jpb06/jpb06/master/icons/Jest.svg" alt="jest" width="60" height="60"/></a><a href="https://www.npmjs.com/~jpb06" target="_blank"><img src="https://raw.githubusercontent.com/jpb06/jpb06/master/icons/Npm-Dark.svg" alt="npm" width="60" height="60"/></a><a href="https://www.markdownguide.org/" target="_blank"><img src="https://raw.githubusercontent.com/jpb06/jpb06/master/icons/Markdown-Dark.svg" alt="markdown" height="60" /></a><a href="https://prettier.io/docs/en/index.html" target="_blank"><img height="60" src="https://raw.githubusercontent.com/jpb06/jpb06/master/icons/Prettier-Dark.svg" /></a></p>


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
