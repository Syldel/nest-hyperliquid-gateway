import { Module } from '@nestjs/common';

import { CryptoModule } from '../crypto/crypto.module';
import { HyperliquidTradeController } from './controllers/hyperliquid-trade.controller';
import { HyperliquidInfoController } from './controllers/hyperliquid-info.controller';
import { HyperliquidOrderController } from './controllers/hyperliquid-order.controller';
import { HyperliquidConfigService } from './config/hyperliquid-config.service';
import { HyperliquidApiTradeService } from './services/hyperliquid-api-trade.service';
import { HyperliquidApiInfoService } from './services/hyperliquid-api-info.service';
import { HyperliquidOrderService } from './services/hyperliquid-order.service';
import { MarketMetaCacheService } from './services/market-meta-cache.service';
import { AssetRegistryService } from './services/asset-registry.service';
import { ValueFormatterService } from './services/value-formatter.service';

@Module({
  imports: [CryptoModule],
  controllers: [
    HyperliquidTradeController,
    HyperliquidInfoController,
    HyperliquidOrderController,
  ],
  providers: [
    HyperliquidConfigService,
    HyperliquidApiTradeService,
    HyperliquidApiInfoService,
    HyperliquidOrderService,
    MarketMetaCacheService,
    ValueFormatterService,
    AssetRegistryService,
  ],
})
export class HyperliquidModule {}
