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
import { JwtSecrets } from './jwt-secret';

@Controller('internal')
export class InternalSyncController {
  private readonly logger = new Logger(InternalSyncController.name);
  constructor(
    private readonly userClient: UserClient,
    private readonly secrets: JwtSecrets,
  ) {}

  /**
   * Seul nest-mongo-user appelle cette route, par son webhook, après une
   * modification des utilisateurs. Elle relit les clés d'agent en cache auprès
   * de lui (aucun appel à Hyperliquid).
   *
   * La vérification est séparée du travail : le `try` englobait aussi la
   * relecture, et son échec aurait été journalisé « Security alert » et
   * répondu 401, un faux diagnostic.
   */
  @Post('sync')
  async triggerSync(@Headers('authorization') auth: string) {
    const payload = this.authorize(auth);
    this.logger.log(`Sync authorized for: ${payload.sub}`);
    await this.userClient.refreshExistingCache();
    return { success: true };
  }

  private authorize(auth: string | undefined): InternalJwtPayload {
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid Authorization header',
      );
    }

    // Hors du `try` : un secret non chargé est une erreur du serveur, pas un
    // jeton invalide.
    const secret = this.secrets.serviceSecret;
    let payload: InternalJwtPayload;
    try {
      // Signature, algorithme et `exp` s'il est présent.
      payload = PureJwtUtil.verify<InternalJwtPayload>(
        auth.split(' ')[1],
        secret,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Security alert: Unauthorized sync attempt. ${message}`,
      );
      throw new UnauthorizedException('Invalid or expired token');
    }

    const refusal = syncTokenRefusal(payload, Math.floor(Date.now() / 1000));
    if (refusal) {
      this.logger.error(
        `Security alert: Unauthorized sync attempt. ${refusal}`,
      );
      throw new UnauthorizedException('Invalid or expired token');
    }
    return payload;
  }
}

/** L'émetteur du webhook de synchro. */
export const SYNC_ISSUER = 'nest-mongo-user';

/** Tolérance d'horloge pour un `iat` dans le futur. */
const CLOCK_SKEW_SECONDS = 30;

/**
 * Pourquoi un jeton de service, déjà vérifié, est refusé sur cette route ;
 * `null` s'il est accepté. Même règle que la route de synchro du bot.
 *
 * - **Sans `exp`, refusé** : PureJwtUtil ne contrôle `exp` que s'il est
 *   présent ; le bot signait ses jetons `users:read` sans (corrigé le
 *   2026-11-03), et un tel jeton, fuité, n'expirait jamais.
 * - **Émis par un autre que nest-mongo-user, refusé** : le secret de service
 *   est partagé (docs/service-tokens.md de nest-mongo-user), donc ceci
 *   n'empêche pas de forger un jeton ; cela empêche de rejouer ici le jeton
 *   légitime d'un autre service (RFC 8725 §3.12).
 * - **`iat` dans le futur, refusé** : au-delà de la tolérance d'horloge. Ce
 *   n'est pas une protection contre le rejeu, que seul `exp` borne.
 */
export function syncTokenRefusal(
  payload: Partial<InternalJwtPayload>,
  nowSeconds: number,
): string | null {
  if (typeof payload.exp !== 'number') {
    return 'token without expiry';
  }
  if (payload.sub !== SYNC_ISSUER) {
    return `token issued by ${JSON.stringify(payload.sub)}, not ${SYNC_ISSUER}`;
  }
  if (
    typeof payload.iat === 'number' &&
    payload.iat > nowSeconds + CLOCK_SKEW_SECONDS
  ) {
    return 'token issued in the future (clock skew?)';
  }
  return null;
}
