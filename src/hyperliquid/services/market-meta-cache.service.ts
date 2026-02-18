import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Subject } from 'rxjs';
import { HyperliquidApiPublicInfoService } from './hyperliquid-api-public-info.service';
import { HLPerpMeta, HLSpotMeta } from '@syldel/hl-shared-types';
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

  private perpMeta: CachedMeta<HLPerpMeta> = { data: null, lastUpdated: 0 };
  private spotMeta: CachedMeta<HLSpotMeta> = { data: null, lastUpdated: 0 };

  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly infoService: HyperliquidApiPublicInfoService,
    private readonly config: HyperliquidConfigService,
  ) {}

  onModuleInit() {
    this.intervalId = setInterval(() => {
      this.refreshAll().catch((err) => this.logger.error('refresh error', err));
    }, this.config.marketRefreshInterval);
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.logger.log('🛑 Market refresh job stopped');
    }
  }

  private async refreshAll() {
    // this.logger.log('Refreshing Hyperliquid meta cache…');
    await Promise.all([this.refreshPerpMeta(), this.refreshSpotMeta()]);
    this.metaUpdatedSubject.next();
  }

  async refreshPerpMeta(testnet = false) {
    const meta = await this.infoService.getPerpMarketMeta(testnet);
    this.logger.log(
      `PERP meta refreshed: universe:${meta?.universe?.length} marginTables:${meta?.marginTables?.length}`,
    );
    this.perpMeta = { data: meta, lastUpdated: Date.now() };
  }

  async refreshSpotMeta(testnet = false) {
    const meta = await this.infoService.getSpotMarketMeta(testnet);
    this.logger.log(
      `SPOT meta refreshed: tokens:${meta?.tokens?.length} universe:${meta?.universe?.length}`,
    );
    this.spotMeta = { data: meta, lastUpdated: Date.now() };
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

  async ensurePerpMeta(testnet = false): Promise<HLPerpMeta> {
    if (!this.perpMeta.data) {
      await this.refreshPerpMeta(testnet);
    }
    return this.perpMeta.data!;
  }

  async ensureSpotMeta(testnet = false): Promise<HLSpotMeta> {
    if (!this.spotMeta.data) {
      await this.refreshSpotMeta(testnet);
    }
    return this.spotMeta.data!;
  }
}
