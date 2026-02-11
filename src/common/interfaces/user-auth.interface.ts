import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user: ActiveUser;
}

export interface JwtUserPayload {
  sub: string; // ID de l'utilisateur (MongoDB _id)
  wallet: string;
  username: string;
  iat?: number;
  exp?: number;
}

export interface ActiveUser {
  id: string;
  wallet: string;
  username: string;
}
