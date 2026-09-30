import type { ProviderAdapter, ProviderIdentity, CredentialValidationResult, HealthCheckResult, NormalizedError } from '../adapter.js';

const DEFAULT_BASE = process.env.GITDB_BASE_URL || 'https://github-store.onrender.com';

export class GitDbProvider implements ProviderAdapter {
  readonly provider = 'gitdb';

  private base() {
    return (process.env.GITDB_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
  }

  private async request(secret: string, path: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      return await fetch(`${this.base()}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${secret.trim()}`,
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async getIdentity(secret: string): Promise<ProviderIdentity> {
    const res = await this.request(secret, '/v1/objects?limit=1');
    if (!res.ok) throw new Error(`GitDB key was rejected: HTTP ${res.status}`);
    const body = await res.json();
    if (!body?.success) throw new Error(body?.error?.message || 'GitDB key is not valid.');
    const total = Number(body.data?.total || 0);
    return {
      provider: 'gitdb',
      accountId: 'api_91b68a',
      accountName: 'GitDB github-store',
      username: 'gitdb',
      organization: 'github-store',
      scopes: ['objects.read', 'objects.write'],
      metadata: { baseUrl: this.base(), objects: total },
      rateLimit: { limit: 5000, remaining: 4999 },
    };
  }

  async validateCredential(secret: string): Promise<CredentialValidationResult> {
    try {
      const identity = await this.getIdentity(secret);
      return { valid: true, identity, permissions: identity.scopes };
    } catch (err: any) {
      return { valid: false, error: String(err.message || err) };
    }
  }

  getCapabilities(): string[] {
    return ['objects.read', 'objects.write', 'objects.list'];
  }

  async listResources(secret: string, resourceType: string): Promise<any[]> {
    if (resourceType !== 'objects' && resourceType !== 'collections') {
      throw new Error(`Unsupported GitDB resource: ${resourceType}`);
    }
    const res = await this.request(secret, '/v1/objects?limit=100');
    if (!res.ok) throw new Error(`GitDB list failed: HTTP ${res.status}`);
    const body = await res.json();
    const items = body?.data?.items || [];
    if (resourceType === 'collections') {
      return [...new Set(items.map((row: any) => row.collection).filter(Boolean))].map((name) => ({ name }));
    }
    return items;
  }

  async getResource(secret: string, _resourceType: string, resourceId: string): Promise<any> {
    const res = await this.request(secret, `/v1/objects/${encodeURIComponent(resourceId)}`);
    if (!res.ok) throw new Error(`GitDB object failed: HTTP ${res.status}`);
    const meta = await res.json();
    const contentRes = await this.request(secret, `/v1/objects/${encodeURIComponent(resourceId)}/content`);
    const content = contentRes.ok ? await contentRes.text() : null;
    return { ...(meta.data || meta), content };
  }

  async performAction(secret: string, action: string, params: any): Promise<any> {
    if (action !== 'write_object' && action !== 'create_object') throw new Error(`Unsupported GitDB action: ${action}`);
    const payload = {
      collection: params.collection || 'control_center',
      path: params.path,
      content: typeof params.content === 'string' ? params.content : JSON.stringify(params.content ?? {}),
    };
    const res = await this.request(secret, '/v1/objects', { method: 'POST', body: JSON.stringify(payload) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.success === false) throw new Error(body?.error?.message || `GitDB write failed: HTTP ${res.status}`);
    return body.data || body;
  }

  async healthCheck(secret: string): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const res = await this.request(secret, '/v1/objects?limit=1');
      const ok = res.ok;
      return { healthy: ok, latencyMs: Date.now() - start, message: ok ? 'GitDB objects API is reachable.' : `GitDB health failed: HTTP ${res.status}` };
    } catch (err: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: String(err.message || err) };
    }
  }

  async revoke(_secret: string): Promise<boolean> { return false; }
  normalizeError(err: any): NormalizedError {
    return { code: 'GITDB_ERROR', message: String(err?.message || err), isTransient: false };
  }
}
