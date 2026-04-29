import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Subject } from 'rxjs';
import { HyperliquidApiPublicInfoService } from './hyperliquid-api-public-info.service';
import { HLPerpDex, HLPerpMeta, HLSpotMeta } from '@syldel/hl-shared-types';
import { HyperliquidConfigService } from '../config/hyperliquid-config.service';

interface CachedMeta<T> {
  data: T | null;
  lastUpdated: number;
}

@Injectable()
export class MarketMetaCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketMetaCacheService.name);

  private readonly metaUpdatedSubject = new Subject<void>();
  readonly onMetaUpdated$ = this.metaUpdatedSubject.asObservable();

  /** Metadata storage */
  private perpMetas = new Map<string, CachedMeta<HLPerpMeta>>();
  private spotMetas = new Map<string, CachedMeta<HLSpotMeta>>();

  /** List of indexed DEXs (HIP-3) */
  private allPerpDexs: HLPerpDex[] = [];

  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly infoService: HyperliquidApiPublicInfoService,
    private readonly config: HyperliquidConfigService,
  ) {}

  onModuleInit() {
    this.intervalId = setInterval(() => {
      this.refreshAll().catch((err) =>
        this.logger.error('Refresh cycle error', err),
      );
    }, this.config.marketRefreshInterval);
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.logger.log('🛑 Market refresh job stopped');
    }
  }

  /**
   * Refreshes everything: DEX list, Metadata for each DEX, and Spot metadata.
   */
  async refreshAll(testnet = false) {
    try {
      const builders = await this.infoService.getAllPerpDexs(testnet);

      this.allPerpDexs = [
        { name: '', fullName: 'Hyperliquid Main DEX' } as HLPerpDex,
        ...builders,
      ];

      const perpPromises = this.allPerpDexs.map((dex) => {
        const dexName = dex?.name || '';
        return this.refreshPerpMeta(dexName, testnet);
      });

      await Promise.all([...perpPromises, this.refreshSpotMeta(testnet)]);

      this.metaUpdatedSubject.next();
      this.logger.log(
        `✅ Global Cache Refresh Complete (${this.allPerpDexs.length} DEXs indexed)`,
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to refresh global market data: ${msg}`);
    }
  }

  /**
   * Generates a unique key to distinguish between testnet/mainnet and specific DEXs.
   */
  private getCacheKey(testnet: boolean, dex: string = ''): string {
    const env = testnet ? 'testnet' : 'mainnet';
    return `${env}:${dex.toLowerCase()}`;
  }

  /**
   * Refreshes Perp metadata for a specific DEX.
   * The cache key combines the environment and the DEX name.
   */
  async refreshPerpMeta(
    dex: string = '',
    testnet: boolean = false,
  ): Promise<void> {
    const key = this.getCacheKey(testnet, dex);
    try {
      const meta = await this.infoService.getPerpMarketMeta(dex, testnet);

      this.perpMetas.set(key, {
        data: meta,
        lastUpdated: Date.now(),
      });

      this.logger.log(
        `PERP meta refreshed [${key}]: universe:${meta?.universe?.length} assets`,
      );
    } catch (error) {
      this.logger.error(`Failed to refresh PERP meta for ${key}`, error);
      throw error;
    }
  }

  /**
   * Refreshes Spot metadata (global to the protocol).
   */
  async refreshSpotMeta(testnet: boolean = false): Promise<void> {
    const key = this.getCacheKey(testnet);
    try {
      const meta = await this.infoService.getSpotMarketMeta(testnet);

      this.spotMetas.set(key, {
        data: meta,
        lastUpdated: Date.now(),
      });

      this.logger.log(
        `SPOT meta refreshed [${key}]: tokens:${meta?.tokens?.length} universe:${meta?.universe?.length}`,
      );
    } catch (error) {
      this.logger.error(`Failed to refresh SPOT meta for ${key}`, error);
      throw error;
    }
  }

  //   getPerpMeta(): HLPerpMeta | null {
  //     return this.perpMeta.data;
  //   }

  //   getSpotMeta(): HLSpotMeta | null {
  //     return this.spotMeta.data;
  //   }

  //   getPerpMetaAgeMs(): number {
  //     return Date.now() - this.perpMeta.lastUpdated;
  //   }

  //   getSpotMetaAgeMs(): number {
  //     return Date.now() - this.spotMeta.lastUpdated;
  //   }

  /**
   * Accessor to retrieve the list of indexed DEXs.
   */
  getAvailableDexs(): HLPerpDex[] {
    return this.allPerpDexs;
  }

  /**
   * Retrieves Perp metadata from cache or downloads it if missing.
   */
  async ensurePerpMeta(
    dex: string = '',
    testnet: boolean = false,
  ): Promise<HLPerpMeta> {
    const key = this.getCacheKey(testnet, dex);
    const cached = this.perpMetas.get(key);

    if (!cached || !cached.data) {
      await this.refreshPerpMeta(dex, testnet);
    }

    return this.perpMetas.get(key)!.data!;
  }

  /**
   * Retrieves Spot metadata from cache or downloads it if missing.
   */
  async ensureSpotMeta(testnet = false): Promise<HLSpotMeta> {
    const key = this.getCacheKey(testnet);
    const cached = this.spotMetas.get(key);

    if (!cached || !cached.data) {
      await this.refreshSpotMeta(testnet);
    }

    return this.spotMetas.get(key)!.data!;
  }

  /**
   * Ensures the DEX list is available.
   * If empty, it fetches it only once.
   */
  async ensureDexs(testnet = false): Promise<HLPerpDex[]> {
    if (this.allPerpDexs.length === 0) {
      const builders = await this.infoService.getAllPerpDexs(testnet);

      this.allPerpDexs = [
        { name: '', fullName: 'Hyperliquid Main DEX' } as HLPerpDex,
        ...builders,
      ];

      this.logger.log(`DEXs list initialized: ${builders.length} found.`);
    }
    return this.allPerpDexs;
  }
}
