import { Module } from '@nestjs/common';
import { UserContextService } from './user-context.service';
import { UserClient } from './user-client.service';
import { CryptoModule } from '../crypto/crypto.module';
import { InternalSyncController } from './internal-sync.controller';
import { JwtSecrets } from './jwt-secret';

@Module({
  imports: [CryptoModule],
  controllers: [InternalSyncController],
  providers: [UserContextService, UserClient, JwtSecrets],
  exports: [UserContextService, UserClient, JwtSecrets],
})
export class AuthModule {}
