/**
 * Le contexte auquel une clé d'agent est liée dans son JWE. nest-mongo-user
 * scelle avec exactement la même chaîne (`src/users/agent-key.ts`, utilisée
 * par `set-agent-key`) : les deux définitions doivent rester identiques, sinon
 * plus aucune clé ne s'ouvre ici.
 */
export function agentKeyContext(userId: string): string {
  return `hl-agent-key:${userId}`;
}

/**
 * Le cache en mémoire rechiffre chaque clé sous une clé de session tirée au
 * démarrage : son `kid` et son contexte la séparent des clés stockées.
 */
export const SESSION_KID = 'session';

export function sessionContext(userId: string): string {
  return `session:${userId}`;
}
