import { Module } from '@nestjs/common';
import { UserContextService } from './user-context.service';
import { UserClient } from './user-client.service';
import { CryptoModule } from '../crypto/crypto.module';
import { InternalSyncController } from './internal-sync.controller';

@Module({
  imports: [CryptoModule],
  controllers: [InternalSyncController],
  providers: [UserContextService, UserClient],
  exports: [UserContextService, UserClient],
})
export class AuthModule {}
