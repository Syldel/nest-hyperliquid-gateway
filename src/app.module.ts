import { Module } from '@nestjs/common';
import { HyperliquidModule } from './hyperliquid/hyperliquid.module';

@Module({
  imports: [HyperliquidModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
