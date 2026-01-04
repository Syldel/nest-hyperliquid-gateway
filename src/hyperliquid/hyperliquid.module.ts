import { Module } from '@nestjs/common';

import { CryptoModule } from '../crypto/crypto.module';
import { HyperliquidTradeController } from './controllers/hyperliquid-trade.controller';
import { HyperliquidInfoController } from './controllers/hyperliquid-info.controller';
import { InstantOrderController } from './controllers/instant-order.controller';
import { ProtectiveOrdersController } from './controllers/protective-order.controller';
import { HyperliquidConfigService } from './config/hyperliquid-config.service';
import { HyperliquidApiTradeService } from './services/hyperliquid-api-trade.service';
import { HyperliquidApiInfoService } from './services/hyperliquid-api-info.service';
import { MarketMetaCacheService } from './services/market-meta-cache.service';
import { AssetRegistryService } from './services/asset-registry.service';
import { ValueFormatterService } from './services/value-formatter.service';
import { SmartOrderService } from './services/smart-order.service';
import { DecimalUtilsService } from './utils/decimal-utils.service';
import { PriceMathService } from './services/price-math.service';

@Module({
  imports: [CryptoModule],
  controllers: [
    HyperliquidTradeController,
    HyperliquidInfoController,
    InstantOrderController,
    ProtectiveOrdersController,
  ],
  providers: [
    HyperliquidConfigService,
    HyperliquidApiTradeService,
    HyperliquidApiInfoService,
    MarketMetaCacheService,
    ValueFormatterService,
    AssetRegistryService,
    SmartOrderService,
    DecimalUtilsService,
    PriceMathService,
  ],
})
export class HyperliquidModule {}
