import type {
  ProviderAdapter,
  ProviderIdentity,
  CredentialValidationResult,
  HealthCheckResult,
  NormalizedError,
} from '../adapter.js';

export class GitHubProvider implements ProviderAdapter {
  readonly provider = 'github';
  private baseUrl = 'https://api.github.com';

  private async request(path: string, token: string, options: RequestInit = {}): Promise<Response> {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
      Authorization: `Bearer ${token.trim()}`,
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
    const res = await this.request('/user', secret);
    if (!res.ok) {
      throw new Error(`GitHub identity verification failed: HTTP ${res.status}`);
    }

    const data = await res.json();
    const scopesHeader = res.headers.get('x-oauth-scopes') || '';
    const scopes = scopesHeader
      ? scopesHeader.split(',').map((s) => s.trim())
      : [];

    const limitHeader = res.headers.get('x-ratelimit-limit');
    const remainingHeader = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    const limit = limitHeader ? Number.parseInt(limitHeader, 10) : undefined;
    const remaining = remainingHeader ? Number.parseInt(remainingHeader, 10) : undefined;

    return {
      provider: 'github',
      accountId: String(data.id),
      accountName: data.name || data.login,
      username: data.login,
      avatarUrl: data.avatar_url,
      email: data.email || undefined,
      scopes,
      ...(limit !== undefined && remaining !== undefined ? {
        rateLimit: {
          limit,
          remaining,
          resetAt: reset && Number.isFinite(Number.parseInt(reset, 10)) ? new Date(Number.parseInt(reset, 10) * 1000).toISOString() : undefined,
        },
      } : {}),
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
        error: err.message || 'Invalid GitHub token or connection failed',
      };
    }
  }

  getCapabilities(): string[] {
    return [
      'github.read',
      'github.account.read',
      'github.repository.list',
      'github.repository.create',
      'github.repository.read',
      'github.repository.write',
      'github.repository.delete',
      'github.branch.read',
      'github.branch.write',
      'github.commit.read',
      'github.commit.write',
      'github.file.read',
      'github.file.write',
    ];
  }

  async listResources(secret: string, resourceType: string, options: any = {}): Promise<any[]> {
    if (resourceType === 'repositories') {
      const perPage = Math.min(Number(options.perPage || 100), 100);
      let page = Math.max(Number(options.page || 1), 1);
      const maxPages = Math.min(Math.max(Number(options.maxPages || 100), 1), 100);
      const all: any[] = [];
      for (let i = 0; i < maxPages; i++, page++) {
        const res = await this.request(
          `/user/repos?sort=updated&per_page=${perPage}&page=${page}&type=all`,
          secret
        );
        if (!res.ok) throw new Error(`Failed to list GitHub repositories: HTTP ${res.status}`);
        const repos = await res.json();
        if (!Array.isArray(repos) || repos.length === 0) break;
        all.push(...repos);
        const link = res.headers.get('link') || '';
        if (!/rel=\"next\"/.test(link)) break;
      }
      return all.map((r: any) => ({
        id: String(r.id),
        name: r.name,
        fullName: r.full_name,
        owner: r.owner?.login,
        private: r.private,
        htmlUrl: r.html_url,
        description: r.description,
        defaultBranch: r.default_branch,
        updatedAt: r.updated_at,
      }));
    }

    if (resourceType === 'branches') {
      const { owner, repo } = options;
      if (!owner || !repo) throw new Error('Owner and repo are required to list branches');
      const res = await this.request(`/repos/${owner}/${repo}/branches`, secret);
      if (!res.ok) throw new Error(`Failed to list branches: HTTP ${res.status}`);
      return await res.json();
    }

    throw new Error(`Unsupported resource type: ${resourceType}`);
  }

  async getResource(secret: string, resourceType: string, resourceId: string): Promise<any> {
    if (resourceType === 'repository') {
      const res = await this.request(`/repos/${resourceId}`, secret);
      if (!res.ok) throw new Error(`Repository ${resourceId} not found: HTTP ${res.status}`);
      return await res.json();
    }
    if (resourceType === 'file') {
      const parts = String(resourceId).split('/');
      if (parts.length < 3) throw new Error('File resource ID must be owner/repository/path.');
      const owner = parts.shift();
      const repo = parts.shift();
      const filePath = parts.join('/');
      const branch = '';
      const query = branch ? `?ref=${encodeURIComponent(branch)}` : '';
      const res = await this.request(`/repos/${encodeURIComponent(owner || '')}/${encodeURIComponent(repo || '')}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}${query}`, secret);
      if (!res.ok) {
        if (res.status === 404) throw new Error(`File ${owner}/${repo}/${filePath} not found`);
        throw new Error(`Failed to read GitHub file ${owner}/${repo}/${filePath}: HTTP ${res.status}`);
      }
      const data = await res.json();
      if (Array.isArray(data)) throw new Error(`Path ${owner}/${repo}/${filePath} is a directory`);
      return { ...data, decodedContent: typeof data.content === 'string' ? Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8') : undefined };
    }
    throw new Error(`Unsupported resource type: ${resourceId}`);
  }

  async performAction(secret: string, action: string, params: any): Promise<any> {
    switch (action) {
      case 'create_repository': {
        const { name, description, isPrivate, autoInit } = params;
        const res = await this.request('/user/repos', secret, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            description: description || 'Created by AI Control Center',
            private: isPrivate ?? true,
            auto_init: autoInit ?? true,
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || `Failed to create repository: HTTP ${res.status}`);
        }
        return await res.json();
      }

      case 'create_or_update_file': {
        const { owner, repo, path, content, contentBase64: providedBase64, message, branch, sha } = params;
        const contentBase64 = providedBase64 || Buffer.from(content ?? '').toString('base64');
        const payload: any = {
          message: message || `Update ${path}`,
          content: contentBase64,
          branch: branch || 'main',
        };
        if (sha) payload.sha = sha;

        const res = await this.request(`/repos/${owner}/${repo}/contents/${path}`, secret, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || `Failed to write file ${path}: HTTP ${res.status}`);
        }
        return await res.json();
      }

      case 'delete_repository': {
        const { owner, repo } = params;
        const res = await this.request(`/repos/${owner}/${repo}`, secret, {
          method: 'DELETE',
        });
        if (!res.ok && res.status !== 204) {
          throw new Error(`Failed to delete repository ${owner}/${repo}: HTTP ${res.status}`);
        }
        return { deleted: true, repository: `${owner}/${repo}` };
      }

      default:
        throw new Error(`Action ${action} not supported by GitHub provider`);
    }
  }

  async healthCheck(secret: string): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const res = await this.request('/user', secret);
      const latencyMs = Date.now() - start;
      const limit = parseInt(res.headers.get('x-ratelimit-limit') || '5000', 10);
      const remaining = parseInt(res.headers.get('x-ratelimit-remaining') || '5000', 10);

      if (res.ok) {
        return {
          healthy: true,
          latencyMs,
          message: `Connected successfully (${remaining}/${limit} rate limit remaining)`,
          rateLimit: { remaining, limit },
        };
      }
      return {
        healthy: false,
        latencyMs,
        message: `GitHub check returned HTTP ${res.status}`,
      };
    } catch (err: any) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: err.message || 'Connection timeout or network failure',
      };
    }
  }

  async revoke(_secret: string): Promise<boolean> {
    // Standard GitHub PATs do not expose a supported remote revoke endpoint here.
    // Local vault removal is handled by the application.
    return false;
  }

  normalizeError(err: any): NormalizedError {
    const msg = String(err.message || err);
    if (msg.includes('401') || msg.includes('Bad credentials')) {
      return {
        code: 'GITHUB_AUTH_FAILED',
        message: 'GitHub authentication failed. Token is invalid or has expired.',
        isTransient: false,
      };
    }
    if (msg.includes('403') || msg.includes('rate limit')) {
      return {
        code: 'GITHUB_RATE_LIMITED_OR_FORBIDDEN',
        message: 'GitHub rate limit exceeded or access forbidden for requested resource.',
        isTransient: true,
      };
    }
    if (msg.includes('404')) {
      return {
        code: 'GITHUB_RESOURCE_NOT_FOUND',
        message: 'The requested GitHub repository or resource was not found.',
        isTransient: false,
      };
    }
    return {
      code: 'GITHUB_ERROR',
      message: msg,
      isTransient: false,
    };
  }
}
