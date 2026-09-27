import { SimpleTokenProvider } from '../simple-token.provider.js';
import type { ProviderIdentity } from '../adapter.js';
export class VercelProvider extends SimpleTokenProvider {
  readonly provider = 'vercel';
  protected identityUrl = 'https://api.vercel.com/v2/user';
  protected capabilities = [];
  async getIdentity(secret: string): Promise<ProviderIdentity> {
    const res = await this.request(this.identityUrl, secret);
    if (!res.ok) throw new Error(`Vercel identity check failed: HTTP ${res.status}`);
    const d = await res.json(); const u=d.user || d;
    return { provider:this.provider, accountId:u.uid || u.id || '', accountName:u.name || u.username || u.email || 'Vercel account', username:u.username, email:u.email, avatarUrl:u.avatar ? `https://vercel.com/api/www/avatar?u=${encodeURIComponent(u.username || u.id || '')}`:undefined };
  }
  protected resourceListUrl(t:string){ return t==='projects' ? 'https://api.vercel.com/v9/projects?limit=100' : null; }
  protected extractList(data:any){ return data.projects || []; }
  protected resourceGetUrl(t:string,id:string){ return t==='project' ? `https://api.vercel.com/v9/projects/${encodeURIComponent(id)}` : null; }
}
