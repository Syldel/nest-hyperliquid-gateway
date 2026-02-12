import { Module } from '@nestjs/common';
import { UserContextService } from './user-context.service';
import { UserClient } from './user-client.service';
import { CryptoModule } from '../crypto/crypto.module';

@Module({
  imports: [CryptoModule],
  providers: [UserContextService, UserClient],
  exports: [UserContextService, UserClient],
})
export class AuthModule {}
