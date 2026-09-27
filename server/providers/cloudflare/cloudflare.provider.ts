import type {
  ProviderAdapter,
  ProviderIdentity,
  CredentialValidationResult,
  HealthCheckResult,
  NormalizedError,
} from '../adapter.js';

export class CloudflareProvider implements ProviderAdapter {
  readonly provider = 'cloudflare';
  private baseUrl = 'https://api.cloudflare.com/client/v4';

  private async request(path: string, token: string, options: RequestInit = {}): Promise<Response> {
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${token.trim()}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getIdentity(secret: string): Promise<ProviderIdentity> {
    const res = await this.request('/user/tokens/verify', secret);
    if (!res.ok) {
      throw new Error(`Cloudflare token verify failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.errors?.[0]?.message || 'Cloudflare token invalid');
    }

    let accountName = `Cloudflare token ${String(data.result?.id || 'unknown').slice(0, 8)}`;
    let email: string | undefined;
    try {
      const userRes = await this.request('/user', secret);
      if (userRes.ok) {
        const user = await userRes.json();
        accountName = user.result?.username || user.result?.email || accountName;
        email = user.result?.email || undefined;
      }
    } catch {}
    return {
      provider: 'cloudflare',
      accountId: data.result?.id || 'cf-token',
      accountName,
      email,
      scopes: ['zones.read', 'dns.read', 'dns.write'],
    };
  }

  async validateCredential(secret: string): Promise<CredentialValidationResult> {
    try {
      const identity = await this.getIdentity(secret);
      return {
        valid: true,
        identity,
        permissions: identity.scopes,
      };
    } catch (err: any) {
      return {
        valid: false,
        error: err.message || 'Invalid Cloudflare API token',
      };
    }
  }

  getCapabilities(): string[] {
    return ['dns.read', 'dns.write', 'zones.read'];
  }

  async listResources(secret: string, resourceType: string, options: any = {}): Promise<any[]> {
    if (resourceType === 'zones') {
      const res = await this.request('/zones?per_page=50', secret);
      if (!res.ok) throw new Error(`Cloudflare zones request failed: HTTP ${res.status}`);
      const data = await res.json();
      return (data.result || []).map((z: any) => ({
        id: z.id,
        name: z.name,
        status: z.status,
        nameServers: z.name_servers,
      }));
    }

    if (resourceType === 'dns_records') {
      const { zoneId } = options;
      if (!zoneId) throw new Error('zoneId required to list DNS records');
      const res = await this.request(`/zones/${zoneId}/dns_records?per_page=100`, secret);
      if (!res.ok) throw new Error(`Cloudflare DNS list failed: HTTP ${res.status}`);
      const data = await res.json();
      return data.result || [];
    }

    throw new Error(`Unsupported resource: ${resourceType}`);
  }

  async getResource(secret: string, resourceType: string, resourceId: string): Promise<any> {
    if (resourceType === 'zone') {
      const res = await this.request(`/zones/${resourceId}`, secret);
      if (!res.ok) throw new Error(`Zone ${resourceId} not found`);
      const data = await res.json();
      return data.result;
    }
    throw new Error(`Unsupported resource: ${resourceType}`);
  }

  async performAction(secret: string, action: string, params: any): Promise<any> {
    switch (action) {
      case 'create_dns_record': {
        const { zoneId, type, name, content, ttl, proxied } = params;
        const res = await this.request(`/zones/${zoneId}/dns_records`, secret, {
          method: 'POST',
          body: JSON.stringify({
            type: type || 'CNAME',
            name,
            content,
            ttl: ttl || 1,
            proxied: proxied ?? true,
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.errors?.[0]?.message || `DNS record create failed: HTTP ${res.status}`);
        }
        return await res.json();
      }

      default:
        throw new Error(`Action ${action} not supported on Cloudflare provider`);
    }
  }

  async healthCheck(secret: string): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const res = await this.request('/user/tokens/verify', secret);
      const latencyMs = Date.now() - start;
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        return {
          healthy: true,
          latencyMs,
          message: 'Cloudflare API token is verified and active',
        };
      }
      return {
        healthy: false,
        latencyMs,
        message: 'Cloudflare token verification failed',
      };
    } catch (err: any) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: err.message || 'Timeout reaching Cloudflare API',
      };
    }
  }

  async revoke(_secret: string): Promise<boolean> {
    // API token revocation is managed remotely in Cloudflare; this connector does not
    // claim to perform it automatically. The local vault still purges the credential.
    return false;
  }

  normalizeError(err: any): NormalizedError {
    return {
      code: 'CLOUDFLARE_ERROR',
      message: String(err.message || err),
    };
  }
}
