import type { ProviderAdapter, ProviderIdentity, CredentialValidationResult, HealthCheckResult, NormalizedError } from './adapter.js';

export abstract class SimpleTokenProvider implements ProviderAdapter {
  abstract readonly provider: string;
  protected abstract identityUrl: string;
  protected abstract capabilities: string[];

  protected async request(url: string, token: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      return await fetch(url, {
        ...options,
        headers: { Accept: 'application/json', Authorization: `Bearer ${token.trim()}`, ...(options.headers || {}) },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  abstract getIdentity(secret: string): Promise<ProviderIdentity>;

  async validateCredential(secret: string): Promise<CredentialValidationResult> {
    try {
      const identity = await this.getIdentity(secret);
      return { valid: true, identity, permissions: identity.scopes || this.capabilities };
    } catch (err: any) {
      return { valid: false, error: String(err.message || err) };
    }
  }

  getCapabilities(): string[] { return [...this.capabilities]; }

  async listResources(secret: string, resourceType: string, options: any = {}): Promise<any[]> {
    const url = this.resourceListUrl(resourceType, options);
    if (!url) throw new Error(`Unsupported ${this.provider} resource: ${resourceType}`);
    const res = await this.request(url, secret);
    if (!res.ok) throw new Error(`${this.provider} request failed: HTTP ${res.status}`);
    const data = await res.json();
    return this.extractList(data, resourceType);
  }

  protected resourceListUrl(_resourceType: string, _options: any): string | null { return null; }
  protected extractList(data: any, _resourceType: string): any[] {
    if (Array.isArray(data)) return data;
    return data.projects || data.sites || data.items || data.data || [];
  }

  async getResource(secret: string, resourceType: string, resourceId: string): Promise<any> {
    const url = this.resourceGetUrl(resourceType, resourceId);
    if (!url) throw new Error(`Unsupported ${this.provider} resource: ${resourceType}`);
    const res = await this.request(url, secret);
    if (!res.ok) throw new Error(`${this.provider} request failed: HTTP ${res.status}`);
    return res.json();
  }

  protected resourceGetUrl(_resourceType: string, _resourceId: string): string | null { return null; }
  async performAction(_secret: string, action: string, _params: any): Promise<any> { throw new Error(`Action ${action} is not implemented for provider ${this.provider}`); }
  async healthCheck(secret: string): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const res = await this.request(this.identityUrl, secret);
      return { healthy: res.ok, latencyMs: Date.now() - start, message: res.ok ? `${this.provider} credential is valid.` : `${this.provider} credential check failed: HTTP ${res.status}` };
    } catch (err: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: String(err.message || err) };
    }
  }
  async revoke(_secret: string): Promise<boolean> { return false; }
  normalizeError(err: any): NormalizedError { return { code: `${this.provider.toUpperCase()}_ERROR`, message: String(err?.message || err), isTransient: false }; }
}
