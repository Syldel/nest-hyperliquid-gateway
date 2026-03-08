import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { AesGcmUtil, EncryptedData, PureJwtUtil } from '@syldel/crypto-utils';

@Injectable()
export class UserClient {
  private readonly logger = new Logger(UserClient.name);
  private readonly keyCache = new Map<string, EncryptedData>();
  private readonly cacheTimers = new Map<string, NodeJS.Timeout>();

  // Clé de session unique générée à chaque démarrage du serveur
  private readonly sessionKey = crypto.randomBytes(32);

  // TTL (7 jours)
  private readonly TTL_SYNC = 7 * 24 * 60 * 60 * 1000;

  async getDecryptedAgentKey(userId: string): Promise<string> {
    const cached = this.keyCache.get(userId);
    if (cached) {
      return AesGcmUtil.decrypt(cached, this.sessionKey);
    }

    const decryptedKey = await this.fetchAndDecryptKey(userId);

    this.storeInCache(userId, decryptedKey);

    return decryptedKey;
  }

  private storeInCache(userId: string, decryptedKey: string) {
    if (this.cacheTimers.has(userId)) {
      clearTimeout(this.cacheTimers.get(userId));
    }

    const encrypted = AesGcmUtil.encrypt(decryptedKey, this.sessionKey);

    this.keyCache.set(userId, encrypted);

    const timer = setTimeout(() => {
      this.keyCache.delete(userId);
      this.cacheTimers.delete(userId);
    }, this.TTL_SYNC);

    timer.unref();
    this.cacheTimers.set(userId, timer);
  }

  private async fetchAndDecryptKey(userId: string): Promise<string> {
    const serviceSecret = process.env.JWT_SERVICE_SECRET!;
    const userServiceUrl = process.env.NEST_USER_SERVICE_URL!;
    const masterSecret = process.env.AGENT_ENCRYPTION_SECRET!;

    const serviceToken = PureJwtUtil.sign(
      {
        sub: 'nest-hyperliquid-gateway',
        scope: ['users:read', 'users:agentKey'],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      serviceSecret,
    );

    const response = await fetch(
      `${userServiceUrl}/internal/users/${userId}/agent-credentials`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${serviceToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new NotFoundException(`User ${userId} agent key not found`);
      }
      throw new InternalServerErrorException(
        `User service returned ${response.status}`,
      );
    }

    const data = (await response.json()) as EncryptedData;
    if (!data) {
      throw new Error('No agent key data received');
    }

    const decryptedKey = AesGcmUtil.decrypt(data, masterSecret);
    return decryptedKey;
  }

  /**
   * Parcourt le cache actuel et rafraîchit chaque clé
   * en interrogeant le service User.
   */
  async refreshExistingCache(): Promise<void> {
    const userIds = Array.from(this.keyCache.keys());
    if (userIds.length === 0) {
      this.logger.log('[UserClient] Cache is empty, nothing to refresh.');
      return;
    }

    // On utilise allSettled pour ne pas bloquer si un utilisateur a été supprimé
    // entre temps dans la DB du service User.
    const results = await Promise.allSettled(
      userIds.map(async (userId) => {
        const decryptedKey = await this.fetchAndDecryptKey(userId);
        this.storeInCache(userId, decryptedKey);
      }),
    );

    const successCount = results.filter((r) => r.status === 'fulfilled').length;
    this.logger.log(
      `[UserClient] Cache refreshed: ${successCount}/${userIds.length} keys updated.`,
    );
  }
}
