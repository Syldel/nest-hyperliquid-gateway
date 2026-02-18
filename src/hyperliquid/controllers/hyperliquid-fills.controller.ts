import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { HLUserFillsResponse } from '@syldel/hl-shared-types';
import { HyperliquidApiPrivateInfoService } from '../services/hyperliquid-api-private-info.service';
import { UserAuthGuard } from '../../common/guards/user-auth.guard';

@Controller('hyperliquid/fills')
export class HyperliquidFillsController {
  constructor(private readonly infoService: HyperliquidApiPrivateInfoService) {}

  /**
   * GET /hyperliquid/fills
   * Retrieve most recent fills (max 2000)
   */
  @Get()
  @UseGuards(UserAuthGuard)
  async getUserFills(
    @Query('aggregateByTime') aggregateByTime?: string,
    @Query('testnet') testnet?: string,
  ): Promise<HLUserFillsResponse> {
    return this.infoService.getUserFills(
      aggregateByTime === 'true',
      testnet === 'true',
    );
  }

  /**
   * GET /hyperliquid/fills/by-time
   * Retrieve fills within a time range
   */
  @Get('by-time')
  @UseGuards(UserAuthGuard)
  async getUserFillsByTime(
    @Query('startTime') startTime: string,
    @Query('endTime') endTime?: string,
    @Query('aggregateByTime') aggregateByTime?: string,
    @Query('testnet') testnet?: string,
  ): Promise<HLUserFillsResponse> {
    return this.infoService.getUserFillsByTime(
      Number(startTime),
      endTime ? Number(endTime) : undefined,
      aggregateByTime === 'true',
      testnet === 'true',
    );
  }
}
