import * as crypto from 'crypto';

export class PureJwtUtil {
  /**
   * Valide un JWT et retourne un payload de type T
   */
  static verify<T extends object>(token: string, secret: string): T {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    // 1. Vérification de la signature
    const dataToVerify = `${headerB64}.${payloadB64}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(dataToVerify)
      .digest('base64url');

    if (signatureB64 !== expectedSignature) {
      throw new Error('Invalid signature');
    }

    // 2. Décodage sécurisé
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as T;

    // 3. Vérification de l'expiration (si le champ existe dans le type T)
    // On utilise un cast temporaire en record pour accéder à 'exp' sans erreur
    const payloadRecord = payload as Record<string, unknown>;

    if (typeof payloadRecord.exp === 'number') {
      if (Date.now() >= payloadRecord.exp * 1000) {
        throw new Error('Token expired');
      }
    }

    return payload;
  }
}
