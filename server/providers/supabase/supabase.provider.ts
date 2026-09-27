import { SimpleTokenProvider } from '../simple-token.provider.js';
import type { ProviderIdentity } from '../adapter.js';
export class SupabaseProvider extends SimpleTokenProvider {
  readonly provider = 'supabase';
  protected identityUrl = 'https://api.supabase.com/v1/projects?limit=1';
  protected capabilities = [];
  async getIdentity(secret:string):Promise<ProviderIdentity>{ const r=await this.request(this.identityUrl,secret); if(!r.ok) throw new Error(`Supabase Management API check failed: HTTP ${r.status}`); const data=await r.json(); const first=Array.isArray(data)?data[0]:data?.projects?.[0]; return {provider:this.provider,accountId:first?.organization_id||'verified',accountName:first?.organization_name||'Supabase account',username:first?.organization_id}; }
  protected resourceListUrl(t:string){ return t==='projects' ? 'https://api.supabase.com/v1/projects' : null; }
  protected extractList(data:any){ return Array.isArray(data) ? data : data.projects || []; }
  protected resourceGetUrl(t:string,id:string){ return t==='project' ? `https://api.supabase.com/v1/projects/${encodeURIComponent(id)}` : null; }
}
