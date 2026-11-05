import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
  PreconditionFailedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { JweKeyring, JweUtil, PureJwtUtil } from '@syldel/crypto-utils';
import {
  AgentInfo,
  agentKeyContext,
  readAgentInfo,
  SESSION_KID,
  sessionContext,
} from './agent-key';

/** Ce qu'il faut pour signer : la clé en clair, et l'agent déclaré avec elle. */
export interface AgentCredentials {
  privateKey: string;
  agent: AgentInfo;
}

@Injectable()
export class UserClient implements OnModuleInit {
  private readonly logger = new Logger(UserClient.name);
  // La clé y est un JWE scellé sous la clé de session, jamais le clair ;
  // l'agent, public, l'accompagne tel quel.
  private readonly keyCache = new Map<
    string,
    { sealed: string; agent: AgentInfo }
  >();
  private readonly cacheTimers = new Map<string, NodeJS.Timeout>();

  // Clé de session unique générée à chaque démarrage du serveur
  private readonly sessionKeys: JweKeyring = {
    [SESSION_KID]: crypto.randomBytes(32),
  };

  private masterKeys!: JweKeyring;

  // TTL (7 jours)
  private readonly TTL_SYNC = 7 * 24 * 60 * 60 * 1000;

  /**
   * Le trousseau se lit et se valide en entier au démarrage : absent ou
   * abîmé, le service s'arrête au lieu de refuser le premier ordre. Pas dans
   * le constructeur : le `.env` n'est chargé que par celui de
   * HyperliquidConfigService, et l'ordre des constructeurs n'est pas garanti ;
   * `onModuleInit` passe après tous.
   */
  onModuleInit(): void {
    this.masterKeys = JweUtil.parseKeyring(process.env.AGENT_ENCRYPTION_KEYS);
    this.logger.log(
      `Agent key ids accepted: ${Object.keys(this.masterKeys).join(', ')}`,
    );
  }

  /**
   * La clé et son agent. L'expiration n'est **pas** contrôlée ici : elle
   * dépend de l'instant, et une entrée du cache vit sept jours. L'appelant
   * qui signe la contrôle à chaque fois (`agentRefusal`).
   */
  async getAgentCredentials(userId: string): Promise<AgentCredentials> {
    const cached = this.keyCache.get(userId);
    if (cached) {
      return {
        privateKey: JweUtil.open(cached.sealed, {
          keys: this.sessionKeys,
          context: sessionContext(userId),
        }),
        agent: cached.agent,
      };
    }

    const credentials = await this.fetchCredentials(userId);

    this.storeInCache(userId, credentials);

    return credentials;
  }

  private storeInCache(
    userId: string,
    { privateKey, agent }: AgentCredentials,
  ) {
    if (this.cacheTimers.has(userId)) {
      clearTimeout(this.cacheTimers.get(userId));
    }

    const sealed = JweUtil.seal(privateKey, {
      kid: SESSION_KID,
      key: this.sessionKeys[SESSION_KID],
      context: sessionContext(userId),
    });

    this.keyCache.set(userId, { sealed, agent });

    const timer = setTimeout(() => this.evict(userId), this.TTL_SYNC);

    timer.unref();
    this.cacheTimers.set(userId, timer);
  }

  private evict(userId: string) {
    clearTimeout(this.cacheTimers.get(userId));
    this.keyCache.delete(userId);
    this.cacheTimers.delete(userId);
  }

  private async fetchCredentials(userId: string): Promise<AgentCredentials> {
    const serviceSecret = process.env.JWT_SERVICE_SECRET!;
    const userServiceUrl = process.env.NEST_USER_SERVICE_URL!;

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
      // Le message de nest-mongo-user dit quoi faire (une clé encore au format
      // 1.x : relancer set-agent-key) ; « returned 409 » seul ne le disait pas.
      throw new InternalServerErrorException(
        `User service returned ${response.status}: ${await this.errorMessageOf(response)}`,
      );
    }

    const body = (await response.json()) as {
      agentKey?: unknown;
      agent?: unknown;
    };
    if (typeof body.agentKey !== 'string') {
      throw new InternalServerErrorException(
        'User service answered without an agent key string',
      );
    }

    // L'agent avant la clé : sans expiration déclarée, on refuse sans même
    // ouvrir la clé. `agent` absent de la réponse (un nest-mongo-user plus
    // ancien) n'est pas `null` : c'est une réponse inattendue, nommée telle.
    let agent: AgentInfo | null;
    try {
      agent = readAgentInfo(body.agent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(message);
    }
    if (agent === null) {
      this.logger.warn(
        `Agent key of user ${userId} refused: no declared expiry or address`,
      );
      throw new PreconditionFailedException(
        'The agent key has no declared expiry or address: run set-agent-key again',
      );
    }
    const agentKey = body.agentKey;

    // Les erreurs de JweUtil ne contiennent aucun secret et nomment la cause
    // (clé inconnue, contexte d'un autre utilisateur…) : Nest les aurait
    // réduites à « Internal server error ».
    try {
      const privateKey = JweUtil.open(agentKey, {
        keys: this.masterKeys,
        context: agentKeyContext(userId),
      });
      return { privateKey, agent };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Agent key of user ${userId} not opened: ${message}`);
      throw new InternalServerErrorException(
        `Agent key could not be opened: ${message}`,
      );
    }
  }

  private async errorMessageOf(response: Response): Promise<string> {
    const body = await response.text().catch(() => '');
    try {
      const { message } = JSON.parse(body) as { message?: unknown };
      if (typeof message === 'string') return message;
    } catch {
      // pas du JSON : on rend le corps brut, tronqué
    }
    return body.slice(0, 200) || 'no body';
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
        try {
          this.storeInCache(userId, await this.fetchCredentials(userId));
        } catch (error) {
          // L'ancienne entrée ne survit pas à un rafraîchissement refusé : une
          // clé retirée ou remplacée en base ne doit plus signer. Le prochain
          // ordre relira la base et échouera en nommant la cause.
          this.evict(userId);
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Agent key of user ${userId} dropped from the cache: ${message}`,
          );
          throw error;
        }
      }),
    );

    const successCount = results.filter((r) => r.status === 'fulfilled').length;
    this.logger.log(
      `[UserClient] Cache refreshed: ${successCount}/${userIds.length} keys updated.`,
    );
  }
}
