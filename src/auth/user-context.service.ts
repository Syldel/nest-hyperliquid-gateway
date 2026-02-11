import { Injectable, Scope } from '@nestjs/common';
import { ActiveUser } from '../common/interfaces/user-auth.interface';

@Injectable({ scope: Scope.REQUEST }) // Très important : une instance par requête
export class UserContextService {
  private user: ActiveUser;

  setUser(user: ActiveUser) {
    this.user = user;
  }

  get walletAddress(): string {
    return this.user?.wallet.toLowerCase();
  }

  get userId(): string {
    return this.user?.id;
  }
}
