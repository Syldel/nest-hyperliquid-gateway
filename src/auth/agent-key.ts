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

/**
 * Les données publiques de l'agent, servies avec la clé scellée par
 * `GET /internal/users/:id/agent-credentials` de nest-mongo-user (`AgentInfo`
 * dans `src/users/agent-key.ts`, écrites par `set-agent-key`). Déclarées à la
 * saisie, pas lues chez Hyperliquid : l'adresse a été dérivée de la clé, le nom
 * et l'expiration recopiés de la page API.
 */
export interface AgentInfo {
  address: string;
  name: string;
  validUntil: Date;
  keyUpdatedAt: Date;
}

/**
 * Lit `agent` dans la réponse JSON de nest-mongo-user. `null` : une clé
 * enregistrée avant qu'on demande son expiration, que l'appelant refuse en le
 * nommant. Une forme inattendue lève, et n'est jamais lue comme « pas
 * d'expiration » : signer sans expiration connue, c'est découvrir l'agent mort
 * par un refus ambigu de Hyperliquid (« User or API Wallet … does not exist »,
 * mesuré le 2026-10-29), au milieu d'un ordre.
 */
export function readAgentInfo(raw: unknown): AgentInfo | null {
  if (raw === null) return null;
  if (typeof raw !== 'object') {
    throw new Error('User service answered malformed agent data');
  }
  const agent = raw as Record<string, unknown>;
  const date = (v: unknown) => {
    if (typeof v !== 'string') return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const validUntil = date(agent.validUntil);
  const keyUpdatedAt = date(agent.keyUpdatedAt);
  if (
    typeof agent.address !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(agent.address) ||
    typeof agent.name !== 'string' ||
    agent.name.length === 0 ||
    validUntil === null ||
    keyUpdatedAt === null
  ) {
    throw new Error('User service answered malformed agent data');
  }
  return { address: agent.address, name: agent.name, validUntil, keyUpdatedAt };
}

/**
 * Pourquoi cet agent ne doit pas signer, ou `null` s'il le peut.
 *
 * - la clé ne doit pas être celle du **wallet maître** de l'utilisateur :
 *   collée par erreur dans `set-agent-key` (qui la refuse depuis le
 *   2026-11-05) ou écrite à la main en base, elle signerait avec des pouvoirs
 *   qu'un agent n'a pas (retraits, transferts). Sans wallet connu, on refuse ;
 * - l'adresse de la clé déchiffrée doit être celle déclarée : sinon la clé et
 *   ses données ne vont pas ensemble (base modifiée à la main, écriture
 *   partielle), et l'expiration affichée serait celle d'un autre agent ;
 * - l'expiration déclarée ne doit pas être passée. Hyperliquid refuserait de
 *   toute façon, mais avec un message qui ne nomme pas la cause.
 *
 * Le message ne contient que des données publiques : adresses, nom, date.
 */
export function agentRefusal(
  agent: AgentInfo,
  keyAddress: string,
  masterWallet: string | undefined,
  now: number,
): string | null {
  if (!masterWallet) {
    return 'No signed-in wallet to check the agent key against: nothing signed';
  }
  if (keyAddress.toLowerCase() === masterWallet.toLowerCase()) {
    return `The stored agent key is the master wallet ${masterWallet} itself, not an API wallet: run set-agent-key with an API wallet key`;
  }
  if (keyAddress.toLowerCase() !== agent.address.toLowerCase()) {
    return `The agent key belongs to ${keyAddress}, not to the declared agent ${agent.address} ("${agent.name}"): run set-agent-key again`;
  }
  if (now >= agent.validUntil.getTime()) {
    return `The agent "${agent.name}" (${agent.address}) expired on ${agent.validUntil.toISOString()}: authorize a new API wallet on Hyperliquid, then run set-agent-key`;
  }
  return null;
}
