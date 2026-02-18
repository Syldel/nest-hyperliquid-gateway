import { Injectable } from '@nestjs/common';

@Injectable()
export class HyperliquidApiBaseInfoService {
  protected readonly API_URL = 'https://api.hyperliquid.xyz';
  protected readonly TESTNET_API_URL = 'https://testnet.hyperliquid.xyz';

  /**
   * Sélectionne l’URL API en fonction du réseau.
   */
  protected getApiUrl(isTestnet: boolean): string {
    return isTestnet ? this.TESTNET_API_URL : this.API_URL;
  }

  /**
   * Méthode générique pour les requêtes /info.
   */
  protected async executeInfo<T>(
    body: Record<string, unknown>,
    isTestnet: boolean = false,
  ): Promise<T> {
    const response = await fetch(`${this.getApiUrl(isTestnet)}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(
        `Hyperliquid /info error: HTTP ${response.status} – ${errorText}`,
      );
    }

    return (await response.json()) as T;
  }
}
