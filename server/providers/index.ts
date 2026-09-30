import type { ProviderAdapter } from './adapter.js';
import { GitHubProvider } from './github/github.provider.js';
import { RenderProvider } from './render/render.provider.js';
import { CloudflareProvider } from './cloudflare/cloudflare.provider.js';
import { VercelProvider } from './vercel/vercel.provider.js';
import { NetlifyProvider } from './netlify/netlify.provider.js';
import { SupabaseProvider } from './supabase/supabase.provider.js';
import { DigitalOceanProvider } from './digitalocean/digitalocean.provider.js';
import { GitDbProvider } from './gitdb/gitdb.provider.js';

const adapters: Record<string, ProviderAdapter> = {
  github: new GitHubProvider(),
  render: new RenderProvider(),
  cloudflare: new CloudflareProvider(),
  vercel: new VercelProvider(),
  netlify: new NetlifyProvider(),
  supabase: new SupabaseProvider(),
  digitalocean: new DigitalOceanProvider(),
  gitdb: new GitDbProvider(),
};

export function getProviderAdapter(provider: string): ProviderAdapter {
  const adapter = adapters[provider.toLowerCase()];
  if (!adapter) {
    throw new Error(`Provider "${provider}" is not supported or not implemented`);
  }
  return adapter;
}

export function getAllSupportedProviders(): string[] {
  return Object.keys(adapters);
}
