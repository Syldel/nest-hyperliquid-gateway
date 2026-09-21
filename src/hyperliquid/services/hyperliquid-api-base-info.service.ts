import { Injectable } from '@nestjs/common';
import {
  HyperliquidRateGuardService,
  infoRequestWeight,
  parseRetryAfterMs,
} from './hyperliquid-rate-guard.service';

@Injectable()
export class HyperliquidApiBaseInfoService {
  protected readonly API_URL = 'https://api.hyperliquid.xyz';
  protected readonly TESTNET_API_URL = 'https://testnet.hyperliquid.xyz';

  constructor(protected readonly rateGuard: HyperliquidRateGuardService) {}

  /**
   * Sélectionne l'URL API en fonction du réseau.
   */
  protected getApiUrl(isTestnet: boolean): string {
    return isTestnet ? this.TESTNET_API_URL : this.API_URL;
  }

  /**
   * Méthode générique pour les requêtes /info.
   *
   * L'un des **deux seuls** points de sortie vers Hyperliquid — l'autre est
   * `HyperliquidApiTradeService.executeWithNonce`. Tout appel `/info` y passe
   * donc par le garde-fou de débit : refus local pendant une pause ou au-delà
   * du plafond, poids compté à chaque réponse, pause ouverte sur un 429. Voir
   * `hyperliquid-rate-guard.service.ts` et `docs/rate-limits.md`.
   *
   * Tout nouvel appel à Hyperliquid doit passer par ici ou par
   * `executeWithNonce`, jamais par un `fetch` direct : un appel qui contourne
   * le garde-fou n'est ni compté, ni freiné.
   */
  protected async executeInfo<T>(
    body: Record<string, unknown>,
    isTestnet: boolean = false,
  ): Promise<T> {
    const type = String(body.type);
    this.rateGuard.beforeCall('info', infoRequestWeight(type));

    const response = await fetch(`${this.getApiUrl(isTestnet)}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.status === 429) {
      this.rateGuard.recordResponse(infoRequestWeight(type), false);
      // Un vrai 429 vers le client, jamais une `Error` nue que Nest rendrait
      // en 500 : un 500 invite le client à relancer.
      throw this.rateGuard.rateLimited(
        `info:${type}`,
        parseRetryAfterMs(response.headers.get('retry-after')),
      );
    }

    if (!response.ok) {
      this.rateGuard.recordResponse(infoRequestWeight(type), false);
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(
        `Hyperliquid /info error: HTTP ${response.status} - ${errorText}`,
      );
    }

    const data = (await response.json()) as T;
    this.rateGuard.recordResponse(
      infoRequestWeight(type, Array.isArray(data) ? data.length : undefined),
      true,
    );
    return data;
  }
}
