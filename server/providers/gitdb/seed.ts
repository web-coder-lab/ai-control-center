import { db } from '../../database/db.js';
import { encryptSecret, createTokenFingerprint, getSecretLast4 } from '../../security/vault.js';
import { getProviderAdapter } from '../index.js';
import type { ProviderConnection } from '../../../shared/types.js';

export async function seedGitdbFromEnv() {
  const secret = process.env.GITDB_API_KEY?.trim();
  if (!secret) return { seeded: false, reason: 'GITDB_API_KEY missing' };
  const existing = db.getConnections().find((c) => c.provider === 'gitdb');
  if (existing) return { seeded: false, reason: 'already-connected', id: existing.id };
  const validation = await getProviderAdapter('gitdb').validateCredential(secret);
  if (!validation.valid || !validation.identity) return { seeded: false, reason: validation.error || 'invalid' };
  const identity = validation.identity;
  const conn: ProviderConnection = {
    id: `conn_gitdb_${Date.now()}`,
    provider: 'gitdb' as any,
    accountName: identity.accountName,
    label: 'GitDB github-store',
    purpose: 'Object database for Control Center records',
    description: 'Live GitDB at github-store.onrender.com',
    howToUse: 'Use /api/gitdb/objects and Gateway capabilities after granting gitdb access.',
    username: identity.username,
    accountId: identity.accountId,
    status: 'valid',
    permissions: identity.scopes || [],
    lastCheckedAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    secretFingerprint: createTokenFingerprint(secret),
    tokenLast4: getSecretLast4(secret),
    metadata: identity.metadata || {},
  };
  db.saveConnection(conn, encryptSecret(secret));
  return { seeded: true, id: conn.id };
}
