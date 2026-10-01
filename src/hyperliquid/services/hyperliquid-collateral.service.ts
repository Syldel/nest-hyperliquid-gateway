import { Injectable } from '@nestjs/common';
import { HyperliquidApiPrivateInfoService } from './hyperliquid-api-private-info.service';
import {
  AccountAbstractionMode,
  CollateralBalance,
  hlPerpDexOf,
  HLClearinghouseState,
  HLSpotClearinghouseState,
} from '@syldel/hl-shared-types';
import { AssetRegistryService } from './asset-registry.service';

@Injectable()
export class HyperliquidCollateralService {
  private cache = {
    accountMode: null as {
      value: AccountAbstractionMode;
      expiresAt: number;
    } | null,
    perpState: {} as Record<
      string,
      { value: HLClearinghouseState; expiresAt: number }
    >,
    spotBalances: {} as Record<
      string,
      { value: HLSpotClearinghouseState; expiresAt: number }
    >,
  };

  private readonly MODE_TTL = 86400000; // 24 heures
  private readonly BALANCE_TTL = 10000; // 10 secondes

  constructor(
    private readonly assetRegistry: AssetRegistryService,
    private readonly privateInfoService: HyperliquidApiPrivateInfoService,
  ) {}

  /**
   * Récupère le mode d'abstraction du compte (Cache: 24h)
   */
  async getAccountMode(
    isTestnet: boolean = false,
  ): Promise<AccountAbstractionMode> {
    const now = Date.now();
    if (this.cache.accountMode && this.cache.accountMode.expiresAt > now) {
      return this.cache.accountMode.value;
    }

    const mode = await this.privateInfoService.getAccountMode(isTestnet);
    this.cache.accountMode = { value: mode, expiresAt: now + this.MODE_TTL };
    return mode;
  }

  /**
   * Récupère l'état du compte Perp (Cache: 10s)
   */
  private async getCachedPerpState(
    dex: string,
    isTestnet: boolean,
  ): Promise<HLClearinghouseState> {
    const cacheKey = `${isTestnet}-${dex}`;
    const now = Date.now();

    if (this.cache.perpState[cacheKey]?.expiresAt > now) {
      return this.cache.perpState[cacheKey].value;
    }

    const state = await this.privateInfoService.getPerpAccountState({
      dex,
      isTestnet,
    });
    this.cache.perpState[cacheKey] = {
      value: state,
      expiresAt: now + this.BALANCE_TTL,
    };
    return state;
  }

  /**
   * Récupère les soldes Spot (Cache: 10s)
   */
  private async getCachedSpotBalances(
    isTestnet: boolean,
  ): Promise<HLSpotClearinghouseState> {
    const cacheKey = `${isTestnet}`;
    const now = Date.now();

    if (this.cache.spotBalances[cacheKey]?.expiresAt > now) {
      return this.cache.spotBalances[cacheKey].value;
    }

    const balances = await this.privateInfoService.getSpotBalances(isTestnet);
    this.cache.spotBalances[cacheKey] = {
      value: balances,
      expiresAt: now + this.BALANCE_TTL,
    };
    return balances;
  }

  /**
   * Récupère le solde du collatéral requis pour trader un actif donné (Routage + Micro-cache).
   *
   * ⚠️ Rien n'y rend `'0'` par défaut. Un zéro dit « tu n'as rien » ; il ne doit
   * jamais dire « je n'ai pas trouvé ». La distinction n'est pas cosmétique :
   * cette valeur dimensionne des ordres (`hl-protection.service`), et un
   * collatéral non résolu rendu `'0'` fait calculer une taille sur un capital
   * qui n'a jamais été lu.
   *
   * Le test de la condition est une **liste blanche** : seuls `unifiedAccount`
   * et `portfolioMargin` lisent le spot. Ce n'est pas un détail de style — le
   * sens de l'erreur n'est pas symétrique. Un compte unifié lu comme cloisonné
   * rend **moins** de capital (ordre sous-dimensionné, ou refusé) ; un compte
   * cloisonné lu comme unifié en rend **plus** qu'il n'en est mobilisable, donc
   * un ordre surdimensionné. Une valeur inconnue doit tomber du côté prudent.
   *
   * `"default"` et `"unifiedAccount"` sont bien deux modes distincts, vérifié
   * le 2026-10-01 par une transition observée : le compte est passé de l'un à
   * l'autre en acceptant la modale d'Hyperliquid, et la réponse de cette
   * méthode pour `BTC` est passée de `0.0` (état perp) à `0.01079182` (spot
   * USDC) **sans aucune modification de code**.
   * Voir `docs/account-abstraction.md`.
   */
  async getCollateralBalance(
    asset: string,
    collateral?: string,
    isTestnet: boolean = false,
  ): Promise<CollateralBalance> {
    const assetName = asset;
    const mode = await this.getAccountMode(isTestnet);

    // Deux modes dont ce gateway ne sait pas lire le collatéral, et qu'il
    // refuse plutôt que d'approcher. Le refus vient **avant** toute résolution :
    // rendre un collatéral puis un montant faux serait pire que ne rien rendre.
    //
    // `portfolioMargin` réunit plusieurs actifs en un portefeuille unique ; lire
    // une seule ligne le sous-estimerait, et les agréger exigerait de valoriser
    // HYPE et BTC en dollars — une source de prix dans un calcul de collatéral.
    // `dexAbstraction` est arrêté par l'exchange : la doc le décrit, aucun
    // compte ne permet de l'éprouver.
    if (mode === 'portfolioMargin' || mode === 'dexAbstraction') {
      return { status: 'unsupported-mode', mode, asset: assetName };
    }

    // Le collatéral se **dérive** du catalogue : `collateralToken` pour un
    // perp, le token de quote pour une paire spot. La table en dur qui vivait
    // ici (`hyna → USDE`, `cash → USDT`, sinon USDC) n'a pas été corrigée, elle
    // a été supprimée : elle ne couvrait que 2 des 10 dex déployés, et ces deux
    // dex ont été éteints en juin et août 2026.
    const tokenIndex = this.assetRegistry.getCollateralToken(assetName);

    // Un `collateral` explicite est le seul cas où l'appariement se fait par
    // symbole : c'est ce que l'appelant a nommé, et c'est donc sa
    // responsabilité. Sans lui, l'appariement passe par l'index — deux tokens
    // peuvent partager un symbole, aucun ne partage un index.
    const override = collateral?.toUpperCase();
    if (!override && tokenIndex === undefined) {
      return { status: 'unknown-collateral', mode, asset: assetName };
    }

    const symbol =
      override ??
      this.assetRegistry.getTokenSymbol(tokenIndex!) ??
      `token#${tokenIndex}`;
    const collateralToken = override ? null : tokenIndex!;

    // ─── L'EXCEPTION : MARCHÉ PERP EN MODE CLOISONNÉ ─────────────────────────
    //
    // `hlPerpDexOf` plutôt que `isPerp` du registre : celui-ci définit
    // `isPerp = !isSpot && !isBuilder`, si bien qu'un HIP-3 (`cash:TSLA`) n'en
    // était pas un et prenait la branche spot — précisément les dex dont le
    // collatéral n'est pas de l'USDC. La doc est explicite pour le mode
    // Standard : « separate perp and spot balances, separate DEX balances ».
    //
    // `portfolioMargin` ne figure plus dans ce test : ce mode est refusé plus
    // haut. Ne reste donc que la liste blanche `unifiedAccount`, et tout le
    // reste — connu ou futur — tombe du côté cloisonné, qui est le côté
    // prudent : il rend **moins** de capital, jamais plus.
    const perpDex = hlPerpDexOf(assetName);
    if (mode !== 'unifiedAccount' && perpDex !== null) {
      const perpState = await this.getCachedPerpState(perpDex, isTestnet);
      const summary = perpState?.marginSummary;

      if (!summary) {
        return {
          status: 'no-balance-entry',
          mode,
          collateral: symbol,
          collateralToken,
        };
      }

      return {
        status: 'ok',
        mode,
        collateral: symbol,
        collateralToken,
        total: summary.accountValue,
        used: summary.totalMarginUsed,
      };
    }

    // ─── LE CAS GÉNÉRAL : UNIFIÉ OU MARCHÉ SPOT ──────────────────────────────
    const spotState = await this.getCachedSpotBalances(isTestnet);
    const targetBalance = spotState?.balances?.find((balance) =>
      override ? balance.coin === override : balance.token === collateralToken,
    );

    if (!targetBalance) {
      return {
        status: 'no-balance-entry',
        mode,
        collateral: symbol,
        collateralToken,
      };
    }

    return {
      status: 'ok',
      mode,
      collateral: symbol,
      collateralToken,
      total: targetBalance.total,
      used: targetBalance.hold,
    };
  }

  /**
   * Force la suppression du cache des balances.
   */
  clearBalanceCache(): void {
    this.cache.perpState = {};
    this.cache.spotBalances = {};
  }
}
