import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { PureJwtUtil } from '../utils/pure-jwt.util';
import {
  JwtUserPayload,
  ActiveUser,
  AuthenticatedRequest,
} from '../interfaces/user-auth.interface';
import { UserContextService } from '../../auth/user-context.service';

@Injectable()
export class UserAuthGuard implements CanActivate {
  private readonly userSecret = process.env.JWT_USER_SECRET;

  constructor(private readonly userContext: UserContextService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (!token || !this.userSecret) {
      throw new UnauthorizedException('User token missing');
    }

    try {
      const payload = PureJwtUtil.verify<JwtUserPayload>(
        token,
        this.userSecret,
      );

      const activeUser: ActiveUser = {
        id: payload.sub,
        wallet: payload.wallet,
        username: payload.username,
      };

      this.userContext.setUser(activeUser);

      request.user = activeUser;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired user token');
    }
  }
}
