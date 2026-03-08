export interface InternalJwtPayload {
  sub: string;
  iat: number;
  exp: number;
  scope?: string[];
}
