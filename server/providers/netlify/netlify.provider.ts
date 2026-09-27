import { SimpleTokenProvider } from '../simple-token.provider.js';
import type { ProviderIdentity } from '../adapter.js';
export class NetlifyProvider extends SimpleTokenProvider {
  readonly provider = 'netlify';
  protected identityUrl = 'https://api.netlify.com/api/v1/user';
  protected capabilities = [];
  protected async request(url:string, token:string, options:RequestInit={}){ return super.request(url, token, { ...options, headers:{ ...(options.headers||{}), Authorization:`Bearer ${token.trim()}` } }); }
  async getIdentity(secret:string):Promise<ProviderIdentity>{ const r=await this.request(this.identityUrl,secret); if(!r.ok) throw new Error(`Netlify identity check failed: HTTP ${r.status}`); const u=await r.json(); return {provider:this.provider,accountId:u.id||u.email||'',accountName:u.full_name||u.email||'Netlify account',username:u.slug||u.email,email:u.email,avatarUrl:u.avatar_url}; }
  protected resourceListUrl(t:string){ return t==='sites' ? 'https://api.netlify.com/api/v1/sites?per_page=100' : null; }
  protected extractList(data:any){ return Array.isArray(data) ? data : []; }
  protected resourceGetUrl(t:string,id:string){ return t==='site' ? `https://api.netlify.com/api/v1/sites/${encodeURIComponent(id)}` : null; }
}
