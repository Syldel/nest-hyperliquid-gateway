import { Injectable, OnModuleInit } from '@nestjs/common';

/** La forme qu'exige PureJwtUtil depuis crypto-utils 3.0.0. */
const SECRET_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * Lit un secret de signature et refuse, en le nommant, un secret absent ou
 * mal formé. Le message ne cite jamais la valeur.
 */
export function requireJwtSecret(
  name: string,
  value: string | undefined,
): string {
  if (!value || !SECRET_PATTERN.test(value)) {
    throw new Error(
      `${name} must be 64 hex characters, got ${value ? `${value.length} characters` : 'nothing'} (generate it with crypto.randomBytes(32).toString('hex'))`,
    );
  }
  return value;
}

/**
 * Les deux secrets de signature, lus et validés une fois au démarrage : le
 * service s'arrête plutôt que de répondre 401 à chaque requête en accusant le
 * client d'une erreur de configuration.
 *
 * Un fournisseur à part, et non `onModuleInit` dans la garde : UserAuthGuard
 * dépend de UserContextService, à portée par requête, et devient donc lui-même
 * créé à chaque requête ; Nest n'appelle alors **jamais** son `onModuleInit`
 * (mesuré le 2026-11-03, sur un module minimal). Ce fournisseur-ci reste un
 * singleton. Dans `onModuleInit` et non le constructeur : le `.env` n'est
 * chargé que par le constructeur de HyperliquidConfigService.
 */
@Injectable()
export class JwtSecrets implements OnModuleInit {
  private user?: string;
  private service?: string;

  onModuleInit(): void {
    this.user = requireJwtSecret(
      'JWT_USER_SECRET',
      process.env.JWT_USER_SECRET,
    );
    this.service = requireJwtSecret(
      'JWT_SERVICE_SECRET',
      process.env.JWT_SERVICE_SECRET,
    );
  }

  get userSecret(): string {
    return this.loaded(this.user, 'JWT_USER_SECRET');
  }

  get serviceSecret(): string {
    return this.loaded(this.service, 'JWT_SERVICE_SECRET');
  }

  // Lu avant `onModuleInit` : une erreur de câblage, pas un jeton invalide.
  private loaded(value: string | undefined, name: string): string {
    if (value === undefined) {
      throw new Error(`${name} read before JwtSecrets was initialised`);
    }
    return value;
  }
}
