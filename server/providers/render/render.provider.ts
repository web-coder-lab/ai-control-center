import type {
  ProviderAdapter,
  ProviderIdentity,
  CredentialValidationResult,
  HealthCheckResult,
  NormalizedError,
} from '../adapter.js';

export class RenderProvider implements ProviderAdapter {
  readonly provider = 'render';
  private baseUrl = 'https://api.render.com/v1';

  private async request(path: string, apiKey: string, options: RequestInit = {}): Promise<Response> {
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
      'User-Agent': 'AI-Control-Center/1.0',
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
    const [userRes, ownersRes] = await Promise.all([
      this.request('/users', secret),
      this.request('/owners?limit=100', secret),
    ]);
    if (!userRes.ok) {
      throw new Error(`Render identity verification failed: HTTP ${userRes.status}`);
    }
    const user = await userRes.json();
    if (!user?.id && !user?.email && !user?.name) {
      throw new Error('Render API returned no authenticated user identity');
    }

    let owners: any[] = [];
    if (ownersRes.ok) {
      const first = await ownersRes.json();
      owners = Array.isArray(first) ? first.map((item: any) => item?.owner || item).filter(Boolean) : [];
      let cursor = ownersRes.ok && Array.isArray(first) && first.length ? first[first.length - 1]?.cursor : undefined;
      for (let page = 0; cursor && page < 100; page++) {
        const res = await this.request(`/owners?limit=100&cursor=${encodeURIComponent(String(cursor))}`, secret);
        if (!res.ok) break;
        const data = await res.json();
        if (!Array.isArray(data)) break;
        owners.push(...data.map((item: any) => item?.owner || item).filter(Boolean));
        cursor = data.length ? data[data.length - 1]?.cursor : undefined;
        if (data.length < 100) break;
      }
    }

    const limitHeader = userRes.headers.get('RateLimit-Limit') || ownersRes.headers.get('RateLimit-Limit');
    const remainingHeader = userRes.headers.get('RateLimit-Remaining') || ownersRes.headers.get('RateLimit-Remaining');
    const resetHeader = userRes.headers.get('RateLimit-Reset') || ownersRes.headers.get('RateLimit-Reset');
    const limit = limitHeader ? Number.parseInt(limitHeader, 10) : undefined;
    const remaining = remainingHeader ? Number.parseInt(remainingHeader, 10) : undefined;
    const reset = resetHeader ? Number.parseInt(resetHeader, 10) : undefined;

    return {
      provider: 'render',
      accountId: String(user.id),
      accountName: user.name || user.email || 'Render account',
      username: user.username || user.email,
      email: user.email || undefined,
      organization: undefined,
      scopes: [],
      ...(limit !== undefined && remaining !== undefined ? {
        rateLimit: {
          limit,
          remaining,
          resetAt: reset !== undefined && Number.isFinite(reset) ? new Date(reset * 1000).toISOString() : undefined,
        },
      } : {}),
      metadata: {
        workspaces: owners.map((owner) => ({ id: String(owner.id), name: owner.name || owner.email || String(owner.id), email: owner.email, type: owner.type }))
      },
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
        error: err.message || 'Invalid Render API key or connection failed',
      };
    }
  }

  getCapabilities(): string[] {
    return [
      'render.account.read',
      'render.workspace.read',
      'render.service.list',
      'render.service.read',
      'render.service.create',
      'render.service.configure',
      'render.deploy',
      'render.logs',
      'render.restart',
      'render.domain.read',
      'render.domain.write',
      'render.service.delete',
      'render.rollback',
    ];
  }

  async listResources(secret: string, resourceType: string, options: any = {}): Promise<any[]> {
    if (resourceType === 'services') {
      const items: any[] = [];
      let cursor = options.cursor ? String(options.cursor) : undefined;
      for (let page = 0; page < 100; page++) {
        const query = new URLSearchParams({ limit: '100' });
        if (cursor) query.set('cursor', cursor);
        if (options.ownerId) query.set('ownerId', String(options.ownerId));
        const res = await this.request(`/services?${query.toString()}`, secret);
        if (!res.ok) throw new Error(`Failed to list Render services: HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) break;
        items.push(...data);
        const next = data.length ? data[data.length - 1]?.cursor : undefined;
        if (!next || data.length < 100) break;
        cursor = String(next);
      }
      return items.map((item: any) => {
        const s = item.service || item;
        const ownerId = s.ownerId || s.owner_id || s.owner?.id;
        const serviceDetails = s.serviceDetails || s.service_details || {};
        return {
          id: s.id,
          name: s.name,
          type: s.type,
          ownerId: ownerId ? String(ownerId) : undefined,
          repo: s.repo,
          branch: s.branch,
          serviceDetails,
          updatedAt: s.updatedAt || s.updated_at,
          dashboardUrl: s.dashboardUrl || s.dashboard_url,
          url: serviceDetails?.url || s.url || undefined,
          status: s.suspended === 'not_suspended' ? 'active' : s.suspended === 'suspended' ? 'suspended' : 'unknown',
        };
      });
    }

    if (resourceType === 'owners' || resourceType === 'workspaces') {
      const items: any[] = [];
      let cursor = options.cursor ? String(options.cursor) : undefined;
      for (let page = 0; page < 100; page++) {
        const query = new URLSearchParams({ limit: '100' });
        if (cursor) query.set('cursor', cursor);
        const res = await this.request(`/owners?${query.toString()}`, secret);
        if (!res.ok) throw new Error(`Failed to list Render workspaces: HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) break;
        items.push(...data.map((item: any) => item.owner || item).filter(Boolean));
        const next = data.length ? data[data.length - 1]?.cursor : undefined;
        if (!next || data.length < 100) break;
        cursor = String(next);
      }
      return items;
    }

    if (resourceType === 'custom_domains') {
      const { serviceId } = options;
      if (!serviceId) throw new Error('Service ID required to list custom domains');
      const items: any[] = [];
      let cursor = options.cursor ? String(options.cursor) : undefined;
      for (let page = 0; page < 100; page++) {
        const query = new URLSearchParams({ limit: '100' });
        if (cursor) query.set('cursor', cursor);
        const res = await this.request(`/services/${encodeURIComponent(serviceId)}/custom-domains?${query.toString()}`, secret);
        if (!res.ok) throw new Error(`Failed to list Render custom domains: HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) break;
        items.push(...data.map((item: any) => item?.customDomain || item).filter(Boolean));
        const next = data.length ? data[data.length - 1]?.cursor : undefined;
        if (!next || data.length < 100) break;
        cursor = String(next);
      }
      return items;
    }

    if (resourceType === 'env_vars') {
      const { serviceId } = options;
      if (!serviceId) throw new Error('Service ID required to list environment variables');
      const items: any[] = [];
      let cursor = options.cursor ? String(options.cursor) : undefined;
      for (let page = 0; page < 100; page++) {
        const query = new URLSearchParams({ limit: '100' });
        if (cursor) query.set('cursor', cursor);
        const res = await this.request(`/services/${encodeURIComponent(serviceId)}/env-vars?${query.toString()}`, secret);
        if (!res.ok) throw new Error(`Failed to list Render environment variables: HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) break;
        items.push(...data.map((item: any) => ({ key: item?.key || item?.name, configured: true })));
        const next = data.length ? data[data.length - 1]?.cursor : undefined;
        if (!next || data.length < 100) break;
        cursor = String(next);
      }
      return items;
    }

    if (resourceType === 'deployments') {
      const { serviceId } = options;
      if (!serviceId) throw new Error('Service ID required to list deployments');
      const items: any[] = [];
      let cursor = options.cursor ? String(options.cursor) : undefined;
      for (let page = 0; page < 100; page++) {
        const query = new URLSearchParams({ limit: '100' });
        if (cursor) query.set('cursor', cursor);
        const res = await this.request(`/services/${encodeURIComponent(serviceId)}/deploys?${query.toString()}`, secret);
        if (!res.ok) throw new Error(`Failed to list deployments: HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) break;
        items.push(...data);
        const next = data.length ? data[data.length - 1]?.cursor : undefined;
        if (!next || data.length < 100) break;
        cursor = String(next);
      }
      return items.map((item: any) => item.deploy || item);
    }

    throw new Error(`Unsupported resource type: ${resourceType}`);
  }

  async getResource(secret: string, resourceType: string, resourceId: string): Promise<any> {
    if (resourceType === 'service') {
      const res = await this.request(`/services/${resourceId}`, secret);
      if (!res.ok) throw new Error(`Service ${resourceId} not found: HTTP ${res.status}`);
      const data = await res.json();
      const service = data?.service || data;
      return { ...service, ownerId: service?.ownerId || service?.owner_id || service?.owner?.id, dashboardUrl: service?.dashboardUrl || service?.dashboard_url };
    }
    if (resourceType === 'deployment') {
      const [serviceId, deployId] = String(resourceId).split('/');
      if (!serviceId || !deployId) throw new Error('Service ID and deployment ID are required');
      const res = await this.request(`/services/${serviceId}/deploys/${deployId}`, secret);
      if (!res.ok) throw new Error(`Deployment ${resourceId} not found: HTTP ${res.status}`);
      return await res.json();
    }
    if (resourceType === 'custom_domain') {
      const [serviceId, domain] = String(resourceId).split('|');
      if (!serviceId || !domain) throw new Error('Service ID and custom domain identifier are required');
      const res = await this.request(`/services/${encodeURIComponent(serviceId)}/custom-domains/${encodeURIComponent(domain)}`, secret);
      if (!res.ok) throw new Error(`Custom domain ${domain} not found: HTTP ${res.status}`);
      return await res.json();
    }
    throw new Error(`Unsupported resource type: ${resourceType}`);
  }

  async performAction(secret: string, action: string, params: any): Promise<any> {
    switch (action) {
      case 'create_service': {
        const { name, ownerId, repo, branch, serviceType, env, buildCommand, startCommand } = params;
        const type = serviceType || 'web_service';
        const runtime = env || (type === 'web_service' ? 'node' : type === 'static_site' ? undefined : 'node');
        const payload: any = {
          type,
          name,
          ownerId,
          repo,
          branch: branch || 'main',
          autoDeploy: 'yes',
        };
        if (type === 'static_site') {
          payload.serviceDetails = {
            ...(buildCommand ? { buildCommand } : {}),
            publishPath: params.publishPath || 'dist',
          };
        } else {
          payload.serviceDetails = {
            runtime: runtime || 'node',
            plan: params.plan || 'free',
            envSpecificDetails: runtime === 'docker'
              ? { dockerfilePath: params.dockerfilePath || './Dockerfile', ...(params.dockerContext ? { dockerContext: params.dockerContext } : {}), ...(params.dockerCommand ? { dockerCommand: params.dockerCommand } : {}) }
              : { buildCommand: buildCommand || 'npm install', startCommand: startCommand || 'npm start' },
          };
        }

        const res = await this.request('/services', secret, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || `Render create service failed: HTTP ${res.status}`);
        }
        return await res.json();
      }

      case 'trigger_deploy': {
        const { serviceId, clearCache } = params;
        const res = await this.request(`/services/${serviceId}/deploys`, secret, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clearCache: clearCache ? 'clear' : 'do_not_clear' }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || `Trigger deploy failed: HTTP ${res.status}`);
        }
        return await res.json();
      }

      case 'get_logs': {
        const { serviceId, ownerId, startTime, endTime, limit } = params;
        if (!serviceId || !ownerId) throw new Error('serviceId and ownerId are required to fetch Render logs');
        const query = new URLSearchParams({ ownerId: String(ownerId), resource: String(serviceId), direction: 'backward', limit: String(limit || 100) });
        if (startTime) query.set('startTime', new Date(startTime).toISOString());
        if (endTime) query.set('endTime', new Date(endTime).toISOString());
        const res = await this.request(`/logs?${query.toString()}`, secret);
        if (!res.ok) throw new Error(`Failed to fetch Render logs: HTTP ${res.status}`);
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data.logs || data.items || []);
        return { logs: items.map((entry: any) => typeof entry === 'string' ? entry : `${entry.timestamp || entry.time || ''} ${entry.message || entry.text || entry.payload || JSON.stringify(entry)}`.trim()) };
      }

      case 'rollback_deploy': {
        const { serviceId, deployId } = params;
        if (!serviceId || !deployId) throw new Error('serviceId and deployId are required for rollback');
        const res = await this.request(`/services/${serviceId}/rollback`, secret, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deployId }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || `Render rollback failed: HTTP ${res.status}`);
        }
        return await res.json();
      }

      case 'restart_service': {
        const { serviceId } = params;
        const res = await this.request(`/services/${serviceId}/restart`, secret, {
          method: 'POST',
        });
        if (!res.ok) throw new Error(`Restart service failed: HTTP ${res.status}`);
        return await res.json();
      }

      case 'update_service': {
        const { serviceId, branch, repo, buildCommand, startCommand, autoDeploy } = params;
        if (!serviceId) throw new Error('serviceId is required');
        const serviceDetails: Record<string, any> = {};
        if (buildCommand !== undefined) serviceDetails.envSpecificDetails = { ...(serviceDetails.envSpecificDetails || {}), buildCommand };
        if (startCommand !== undefined) serviceDetails.envSpecificDetails = { ...(serviceDetails.envSpecificDetails || {}), startCommand };
        const payload: any = { autoDeploy: autoDeploy === undefined ? undefined : (autoDeploy ? 'yes' : 'no') };
        if (branch !== undefined) payload.branch = branch;
        if (repo !== undefined) payload.repo = repo;
        if (Object.keys(serviceDetails).length) payload.serviceDetails = serviceDetails;
        Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
        const res = await this.request(`/services/${encodeURIComponent(serviceId)}`, secret, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `Update service failed: HTTP ${res.status}`); }
        return await res.json();
      }

      case 'set_env_var': {
        const { serviceId, key, value } = params;
        if (!serviceId || !key || typeof value !== 'string') throw new Error('serviceId, key and value are required');
        const res = await this.request(`/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`, secret, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `Update environment variable failed: HTTP ${res.status}`); }
        const data = await res.json();
        return { key, updated: true, id: data?.id };
      }

      case 'delete_env_var': {
        const { serviceId, key } = params;
        if (!serviceId || !key) throw new Error('serviceId and key are required');
        const res = await this.request(`/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`, secret, { method: 'DELETE' });
        if (!res.ok && res.status !== 204) throw new Error(`Delete environment variable failed: HTTP ${res.status}`);
        return { key, deleted: true, verified: true };
      }

      case 'add_custom_domain': {
        const { serviceId, name } = params;
        if (!serviceId || !name) throw new Error('serviceId and domain name are required');
        const res = await this.request(`/services/${encodeURIComponent(serviceId)}/custom-domains`, secret, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `Add custom domain failed: HTTP ${res.status}`); }
        return await res.json();
      }

      case 'verify_custom_domain': {
        const { serviceId, domain } = params;
        if (!serviceId || !domain) throw new Error('serviceId and domain are required');
        const res = await this.request(`/services/${encodeURIComponent(serviceId)}/custom-domains/${encodeURIComponent(domain)}/verify`, secret, { method: 'POST' });
        if (!res.ok && res.status !== 202) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `Verify custom domain failed: HTTP ${res.status}`); }
        return { accepted: true, status: res.status, domain };
      }

      case 'delete_custom_domain': {
        const { serviceId, domain, confirmed } = params;
        if (!serviceId || !domain) throw new Error('serviceId and domain are required');
        if (!confirmed) throw new Error('Confirmation is required before deleting a custom domain.');
        const res = await this.request(`/services/${encodeURIComponent(serviceId)}/custom-domains/${encodeURIComponent(domain)}`, secret, { method: 'DELETE' });
        if (!res.ok && res.status !== 204) throw new Error(`Delete custom domain failed: HTTP ${res.status}`);
        return { deleted: true, serviceId, domain, verified: true };
      }

      case 'delete_service': {
        const { serviceId } = params;
        const res = await this.request(`/services/${serviceId}`, secret, {
          method: 'DELETE',
        });
        if (!res.ok && res.status !== 204) {
          throw new Error(`Delete service failed: HTTP ${res.status}`);
        }
        return { deleted: true, serviceId };
      }

      default:
        throw new Error(`Action ${action} not supported by Render provider`);
    }
  }

  async healthCheck(secret: string): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const res = await this.request('/owners?limit=1', secret);
      const latencyMs = Date.now() - start;
      if (res.ok) {
        const limit = Number.parseInt(res.headers.get('RateLimit-Limit') || '', 10);
        const remaining = Number.parseInt(res.headers.get('RateLimit-Remaining') || '', 10);
        return {
          healthy: true,
          latencyMs,
          message: 'Render API credential valid and responsive',
          ...(Number.isFinite(limit) && Number.isFinite(remaining) ? { rateLimit: { limit, remaining } } : {}),
        };
      }
      return {
        healthy: false,
        latencyMs,
        message: `Render API returned HTTP ${res.status}`,
      };
    } catch (err: any) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: err.message || 'Connection timeout to Render API',
      };
    }
  }

  async revoke(_secret: string): Promise<boolean> {
    // Render API keys are revoked from the Render dashboard; this adapter does not
    // claim remote revocation support. Local credential destruction remains supported.
    return false;
  }

  normalizeError(err: any): NormalizedError {
    const msg = String(err.message || err);
    if (msg.includes('401') || msg.includes('Unauthorized')) {
      return {
        code: 'RENDER_AUTH_FAILED',
        message: 'Render authentication failed. API key is invalid or revoked.',
        isTransient: false,
      };
    }
    if (msg.includes('404')) {
      return {
        code: 'RENDER_SERVICE_NOT_FOUND',
        message: 'The requested Render service or workspace was not found.',
        isTransient: false,
      };
    }
    return {
      code: 'RENDER_ERROR',
      message: msg,
      isTransient: false,
    };
  }
}
