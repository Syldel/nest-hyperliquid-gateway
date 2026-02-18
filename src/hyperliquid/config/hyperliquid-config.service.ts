import { Injectable } from '@nestjs/common';

import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class HyperliquidConfigService {
  public readonly marketRefreshInterval: number;

  constructor() {
    this.loadEnvFile();

    const requiredVars = ['MARKET_REFRESH_INTERVAL_MS'];
    const missingVars = requiredVars.filter((v) => !process.env[v]);

    if (missingVars.length > 0) {
      throw new Error(
        `Missing required Hyperliquid environment variables: ${missingVars.join(', ')}`,
      );
    }

    const rawInterval = process.env.MARKET_REFRESH_INTERVAL_MS;
    const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
    this.marketRefreshInterval = rawInterval
      ? Number(rawInterval)
      : DEFAULT_INTERVAL_MS;

    if (isNaN(this.marketRefreshInterval) || this.marketRefreshInterval <= 0) {
      console.warn(
        `Invalid MARKET_REFRESH_INTERVAL_MS="${rawInterval}", fallback to ${DEFAULT_INTERVAL_MS}ms`,
      );
      this.marketRefreshInterval = DEFAULT_INTERVAL_MS;
    }

    // console.log(
    //   'Hyperliquid environment variables loaded successfully:',
    //   requiredVars.map((v) => `${v}`),
    // );
  }

  /**
   * Charge automatiquement un fichier .env situé à la racine du projet
   * si certaines variables d'environnement sont manquantes.
   */
  private loadEnvFile(): void {
    const envPath = path.resolve(__dirname, '..', '..', '..', '.env');
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue; // ignorer les lignes vides ou commentaires
      }
      const [key, value] = trimmed.split('=');
      if (key && value && !process.env[key.trim()]) {
        process.env[key.trim()] = value.trim();
      }
    }
  }
}
