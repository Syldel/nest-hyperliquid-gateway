import { Module } from '@nestjs/common';

import { NonceManagerService } from './services/nonce-manager.service';
import { SigningService } from './services/signing.service';
import { WalletService } from './services/wallet.service';

@Module({
  providers: [NonceManagerService, SigningService, WalletService],
  exports: [NonceManagerService, SigningService, WalletService],
})
export class CryptoModule {}
