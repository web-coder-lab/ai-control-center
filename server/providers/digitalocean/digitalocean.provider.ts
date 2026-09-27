import { SimpleTokenProvider } from '../simple-token.provider.js';
import type { ProviderIdentity } from '../adapter.js';
export class DigitalOceanProvider extends SimpleTokenProvider {
  readonly provider = 'digitalocean';
  protected identityUrl = 'https://api.digitalocean.com/v2/account';
  protected capabilities = [];
  async getIdentity(secret:string):Promise<ProviderIdentity>{ const r=await this.request(this.identityUrl,secret); if(!r.ok) throw new Error(`DigitalOcean identity check failed: HTTP ${r.status}`); const d=await r.json(); const a=d.account||d; return {provider:this.provider,accountId:a.uuid||a.droplet_limit?.toString()||'',accountName:a.email||a.status||'DigitalOcean account',username:a.email,email:a.email}; }
  protected resourceListUrl(t:string){ if(t==='droplets') return 'https://api.digitalocean.com/v2/droplets?per_page=200'; if(t==='domains') return 'https://api.digitalocean.com/v2/domains?per_page=200'; return null; }
  protected extractList(data:any,t:string){ return data[t] || []; }
  protected resourceGetUrl(t:string,id:string){ const map:any={droplet:`https://api.digitalocean.com/v2/droplets/${encodeURIComponent(id)}`,domain:`https://api.digitalocean.com/v2/domains/${encodeURIComponent(id)}`}; return map[t]||null; }
}
