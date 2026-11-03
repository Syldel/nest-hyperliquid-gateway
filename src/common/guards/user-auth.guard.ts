import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { PureJwtUtil } from '@syldel/crypto-utils';
import {
  JwtUserPayload,
  ActiveUser,
  AuthenticatedRequest,
} from '../interfaces/user-auth.interface';
import { UserContextService } from '../../auth/user-context.service';
import { JwtSecrets } from '../../auth/jwt-secret';

@Injectable()
export class UserAuthGuard implements CanActivate {
  /**
   * Le secret vient de JwtSecrets, validé au démarrage. Il était lu dans un
   * initialiseur de champ : absent, chaque requête répondait « User token
   * missing », en accusant le client d'une erreur de configuration.
   */
  constructor(
    private readonly userContext: UserContextService,
    private readonly secrets: JwtSecrets,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (!token) {
      throw new UnauthorizedException('User token missing');
    }

    // Hors du `try` : un secret non chargé est une erreur du serveur, pas un
    // jeton invalide.
    const secret = this.secrets.userSecret;
    let payload: JwtUserPayload;
    try {
      // Signature, algorithme et `exp` s'il est présent.
      payload = PureJwtUtil.verify<JwtUserPayload>(token, secret);
    } catch {
      throw new UnauthorizedException('Invalid or expired user token');
    }
    // PureJwtUtil ne contrôle `exp` que s'il est présent : un jeton signé sans
    // n'expirerait jamais. nest-mongo-user et le bot en mettent toujours un.
    if (typeof payload.exp !== 'number') {
      throw new UnauthorizedException('Invalid or expired user token');
    }

    const activeUser: ActiveUser = {
      id: payload.sub,
      wallet: payload.wallet,
      username: payload.username,
    };

    this.userContext.setUser(activeUser);

    request.user = activeUser;
    return true;
  }
}
