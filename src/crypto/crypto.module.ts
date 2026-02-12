import { Module } from '@nestjs/common';

import { NonceManagerService } from './services/nonce-manager.service';
import { SigningService } from './services/signing.service';
import { WalletService } from './services/wallet.service';
import { CryptoService } from './services/crypto.service';

@Module({
  providers: [
    NonceManagerService,
    SigningService,
    WalletService,
    CryptoService,
  ],
  exports: [NonceManagerService, SigningService, WalletService, CryptoService],
})
export class CryptoModule {}
