import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { HyperliquidGatewayException } from '../exceptions/hyperliquid-gateway.exception';

/**
 * ============================================================================
 * 🛡️ LE GARDE-FOU DE DÉBIT VERS HYPERLIQUID
 *
 * Ce gateway est la **seule** sortie vers Hyperliquid pour le bot : tout passe
 * par `HyperliquidApiBaseInfoService.executeInfo` (lectures `/info`) et
 * `HyperliquidApiTradeService.executeWithNonce` (actions `/exchange`). C'est
 * donc ici, et nulle part ailleurs, que l'IP peut être protégée — un client
 * qui se discipline seul ne protège pas contre un autre client, ni contre un
 * redémarrage en boucle.
 *
 * Pourquoi c'est vital : Hyperliquid limite le débit **par IP**. Sa doc ne dit
 * ni quel code d'erreur ni quelle durée de bannissement s'appliquent au-delà ;
 * elle ne laisse aucune marge pour apprendre en production. Voir
 * `docs/rate-limits.md` pour les chiffres et leur source.
 *
 * Trois règles, par ordre d'importance :
 *
 * 1. **Un 429 d'Hyperliquid ouvre une pause globale.** Pendant la pause, plus
 *    AUCUN appel ne part — ni lecture ni ordre : tout est refusé localement
 *    avec un 429, sans toucher le réseau. Auparavant, le 429 devenait une
 *    `Error` nue, que Nest rendait en **500** ; le bot y lisait « panne
 *    passagère » et relançait. Le seul signal qui voulait dire « arrête »
 *    était traduit en « recommence ».
 * 2. **Les pauses s'allongent si les 429 se répètent** (60 s, 2 min, 4 min…,
 *    plafonnées à 10 min), et respectent `Retry-After` quand Hyperliquid le
 *    fournit.
 * 3. **Un plafond local sous le plafond d'Hyperliquid** : au-delà de 80 % du
 *    budget minute, les **lectures** sont refusées localement. Les **ordres**
 *    ne le sont jamais par ce plafond — refuser la fermeture d'une position
 *    parce qu'on a trop lu serait pire que le risque qu'on évite. Ils restent
 *    en revanche soumis à la pause de la règle 1, puisque Hyperliquid les
 *    refuserait de toute façon.
 *
 * ⚠️ L'état vit **en mémoire**. Un redémarrage remet le compteur à zéro — d'où
 * la seconde protection, dans `AssetRegistryService` : un échec au démarrage ne
 * fait plus planter le processus, parce qu'un gateway qui plante au démarrage
 * est relancé par l'hébergeur, rappelle Hyperliquid, replante… C'était le
 * scénario de bannissement le plus plausible.
 * ============================================================================
 */

export type HyperliquidRequestKind = 'info' | 'exchange';

export const RATE_LIMITS = {
  /** Budget documenté par Hyperliquid : poids cumulé par minute et par IP. */
  ipWeightPerMinute: 1200,
  windowMs: 60_000,
  /** Au-delà, les lectures sont refusées localement (jamais les ordres). */
  localCeilingRatio: 0.8,
  /** Au-delà, un avertissement est journalisé (au plus une fois par minute). */
  warnRatio: 0.5,
  cooldownBaseMs: 60_000,
  cooldownMaxMs: 10 * 60_000,
} as const;

/** Poids 2 dans la doc Hyperliquid. */
const LIGHT_INFO_TYPES = new Set([
  'l2Book',
  'allMids',
  'clearinghouseState',
  'orderStatus',
  'spotClearinghouseState',
  'exchangeStatus',
]);

/** Poids 20, plus 1 par tranche de 20 éléments rendus. */
const PER_20_ITEMS_INFO_TYPES = new Set([
  'recentTrades',
  'historicalOrders',
  'userFills',
  'userFillsByTime',
  'fundingHistory',
  'userFunding',
  'nonUserFundingUpdates',
  'twapHistory',
  'userTwapSliceFills',
  'userTwapSliceFillsByTime',
  'delegatorHistory',
  'delegatorRewards',
  'validatorStats',
]);

/**
 * Poids d'une requête `/info`, d'après la table de la doc Hyperliquid.
 *
 * Le supplément « par élément rendu » n'est connu qu'après la réponse : avant
 * l'appel, `itemsReturned` est absent et seul le poids de base compte. Les
 * tranches sont arrondies **au-dessus** : sur-estimer coûte un peu de marge,
 * sous-estimer coûterait l'IP.
 */
export function infoRequestWeight(
  type: string,
  itemsReturned?: number,
): number {
  if (LIGHT_INFO_TYPES.has(type)) return 2;
  if (type === 'userRole') return 60;

  const items = itemsReturned ?? 0;
  if (type === 'candleSnapshot') return 20 + Math.ceil(items / 60);
  if (PER_20_ITEMS_INFO_TYPES.has(type)) return 20 + Math.ceil(items / 20);

  return 20;
}

/**
 * Poids d'une action `/exchange` : `1 + floor(batch_length / 40)`, où la taille
 * du lot est le nombre d'ordres, d'annulations ou de modifications portés.
 */
export function exchangeRequestWeight(action: Record<string, unknown>): number {
  const batch = ['orders', 'cancels', 'modifies']
    .map((key) => action[key])
    .find((value): value is unknown[] => Array.isArray(value));

  return 1 + Math.floor((batch?.length ?? 1) / 40);
}

/**
 * La limite **par adresse** (distincte de celle par IP) se signale par un
 * message, pas forcément par un statut HTTP.
 *
 * ⚠️ Forme non vérifiée en conditions réelles : seul le texte est documenté
 * (« Too many cumulative requests sent (x > y) for cumulative volume
 * traded… »). On reconnaît donc le texte, où qu'il apparaisse.
 */
export function isAddressRateLimitMessage(text: unknown): boolean {
  return typeof text === 'string' && /too many cumulative requests/i.test(text);
}

/** `Retry-After` en secondes → millisecondes ; absent ou illisible → `undefined`. */
export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

interface Entry {
  at: number;
  weight: number;
}

@Injectable()
export class HyperliquidRateGuardService {
  private readonly logger = new Logger(HyperliquidRateGuardService.name);

  private entries: Entry[] = [];
  private cooldownUntil = 0;
  private consecutiveRateLimits = 0;
  private lastWarnAt = 0;

  /**
   * À appeler **avant** chaque requête. Lève un 429 sans toucher le réseau si
   * une pause est en cours, ou si une lecture ferait dépasser le plafond local.
   */
  beforeCall(kind: HyperliquidRequestKind, weight: number): void {
    const now = Date.now();

    if (now < this.cooldownUntil) {
      throw this.exception(
        'HYPERLIQUID_RATE_LIMITED',
        `Hyperliquid rate limit cooldown active: no call is sent for another ${Math.ceil(
          (this.cooldownUntil - now) / 1000,
        )}s.`,
      );
    }

    if (kind === 'info') {
      const used = this.used(now);
      const ceiling = this.ceiling();
      if (used + weight > ceiling) {
        this.logger.warn(
          `Local rate budget reached (${used}/${RATE_LIMITS.ipWeightPerMinute} weight in the last minute, ceiling ${ceiling}). Read refused locally.`,
        );
        throw this.exception(
          'LOCAL_RATE_BUDGET',
          `Local rate budget reached (${used}/${RATE_LIMITS.ipWeightPerMinute} weight in the last minute). Read refused before reaching Hyperliquid.`,
        );
      }
    }
  }

  /**
   * À appeler dès qu'une réponse est reçue, **quel que soit son statut** :
   * Hyperliquid compte la requête, qu'elle réussisse ou non.
   */
  recordResponse(weight: number, ok: boolean): void {
    const now = Date.now();
    this.entries.push({ at: now, weight });
    if (ok) this.consecutiveRateLimits = 0;

    const used = this.used(now);
    const warnAt = RATE_LIMITS.ipWeightPerMinute * RATE_LIMITS.warnRatio;
    if (used >= warnAt && now - this.lastWarnAt >= RATE_LIMITS.windowMs) {
      this.lastWarnAt = now;
      this.logger.warn(
        `Hyperliquid weight used in the last minute: ${used}/${RATE_LIMITS.ipWeightPerMinute}.`,
      );
    }
  }

  /**
   * Hyperliquid vient de refuser pour cause de débit : ouvre la pause globale
   * et rend l'exception à lever. La durée double à chaque 429 consécutif.
   */
  rateLimited(
    source: string,
    retryAfterMs?: number,
  ): HyperliquidGatewayException {
    this.consecutiveRateLimits += 1;

    const backoff = Math.min(
      RATE_LIMITS.cooldownBaseMs * 2 ** (this.consecutiveRateLimits - 1),
      RATE_LIMITS.cooldownMaxMs,
    );
    const duration = Math.max(retryAfterMs ?? 0, backoff);
    this.cooldownUntil = Date.now() + duration;

    this.logger.error(
      `Hyperliquid rate limit hit on ${source} (#${this.consecutiveRateLimits} in a row). All calls paused for ${duration / 1000}s.`,
    );

    return this.exception(
      'HYPERLIQUID_RATE_LIMITED',
      `Hyperliquid rate limit hit on ${source}. All calls paused for ${duration / 1000}s.`,
    );
  }

  /** Pour les journaux et les diagnostics. */
  usage(): { used: number; ceiling: number; cooldownRemainingMs: number } {
    const now = Date.now();
    return {
      used: this.used(now),
      ceiling: this.ceiling(),
      cooldownRemainingMs: Math.max(0, this.cooldownUntil - now),
    };
  }

  private used(now: number): number {
    this.entries = this.entries.filter(
      (entry) => now - entry.at < RATE_LIMITS.windowMs,
    );
    return this.entries.reduce((sum, entry) => sum + entry.weight, 0);
  }

  private ceiling(): number {
    return Math.floor(
      RATE_LIMITS.ipWeightPerMinute * RATE_LIMITS.localCeilingRatio,
    );
  }

  private exception(code: string, message: string) {
    return new HyperliquidGatewayException(
      code,
      message,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
