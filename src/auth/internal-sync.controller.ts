import {
  Controller,
  Post,
  UnauthorizedException,
  Headers,
  Logger,
} from '@nestjs/common';
import { PureJwtUtil } from '@syldel/crypto-utils';
import { InternalJwtPayload } from './internal-payload.interface';
import { UserClient } from './user-client.service';

@Controller('internal')
export class InternalSyncController {
  private readonly logger = new Logger(InternalSyncController.name);

  constructor(private readonly userClient: UserClient) {}

  @Post('sync')
  async triggerSync(@Headers('authorization') auth: string) {
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid Authorization header',
      );
    }

    const token = auth.split(' ')[1];
    const secret = process.env.JWT_SERVICE_SECRET!;

    try {
      // Vérification de la signature et expiration
      const payload = PureJwtUtil.verify<InternalJwtPayload>(token, secret);

      const now = Math.floor(Date.now() / 1000);

      // Vérification explicite de l'expiration
      // if (payload.exp && now > payload.exp) {
      //   throw new UnauthorizedException('Token has expired');
      // }

      // Sécurité supplémentaire : vérifier l'âge du token (iat)
      // pour éviter les attaques par rejeu (replay attacks) trop tardives
      // Marge de 30s pour le décalage horloge
      if (payload.iat && now < payload.iat - 30) {
        throw new UnauthorizedException(
          'Token issued in the future (Clock skew?)',
        );
      }

      this.logger.log(`Sync authorized for: ${payload.sub}`);

      await this.userClient.refreshExistingCache();

      return { success: true };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        `Security alert: Unauthorized sync attempt. ${errorMessage}`,
      );
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
