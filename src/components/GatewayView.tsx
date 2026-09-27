import React, { useEffect, useState } from 'react';
import {
  KeyRound,
  Plus,
  Shield,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Copy,
  Check,
  Code,
  BookOpen,
  Lock,
  Layers,
  Inbox,
} from 'lucide-react';
import type { GatewayKey, TokenRequest, ProviderConnection, BrowserSession, ActivityLog } from '../../shared/types.js';
import { SYSTEM_CAPABILITIES } from '../../shared/capabilities.js';
import { appOrigin } from '../appOrigin.js';

type GatewayKeyCard = GatewayKey & { rateUsed?: number; rateRemaining?: number; rateResetMs?: number };

const lockedCapabilities = new Set([
  'browser.download', 'browser.upload', 'browser.cookie.read', 'browser.cookie.write', 'browser.cookie.delete',
  'browser.storage.read', 'browser.storage.write', 'browser.password.read', 'browser.permission.grant',
]);

interface GatewayViewProps {
  keys: GatewayKeyCard[];
  tokenRequests: TokenRequest[];
  onOpenCreateKeyModal: () => void;
  onRefresh: () => void;
}

export const GatewayView: React.FC<GatewayViewProps> = ({
  keys,
  tokenRequests,
  onOpenCreateKeyModal,
  onRefresh,
}) => {
  const [tab, setTab] = useState<'keys' | 'connections' | 'permissions' | 'requests' | 'capabilities' | 'logs' | 'docs'>('keys');
  const [selectedKeyId, setSelectedKeyId] = useState<string>(keys[0]?.id || '');
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ProviderConnection[]>([]);
  const [browserSessions, setBrowserSessions] = useState<BrowserSession[]>([]);
  const [apiLogs, setApiLogs] = useState<ActivityLog[]>([]);
  const [requestPermissions, setRequestPermissions] = useState<Record<string, string[]>>({});

  const selectedKey = keys.find((k) => k.id === selectedKeyId) || keys[0];

  useEffect(() => {
    if (!selectedKeyId && keys[0]?.id) setSelectedKeyId(keys[0].id);
  }, [keys, selectedKeyId]);

  useEffect(() => {
    if (!['permissions','connections','logs'].includes(tab)) return;
    Promise.all([fetch('/api/accounts').then((r) => r.json()), fetch('/api/browser/sessions').then((r) => r.json()), fetch('/api/logs?limit=150').then((r) => r.json())])
      .then(([a, b, l]) => { setAccounts(a.accounts || []); setBrowserSessions(b.sessions || []); setApiLogs(l.logs || []); })
      .catch(() => {});
  }, [tab]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const handleToggleCapability = async (capabilityId: string) => {
    if (!selectedKey) return;
    const current = selectedKey.capabilities?.[capabilityId] === true;
    const updated = { [capabilityId]: !current };

    try {
      const res = await fetch(`/api/gateway/keys/${selectedKey.id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capabilities: updated }),
      });
      if (res.ok) {
        onRefresh();
      }
    } catch {
      alert('Failed to update permission');
    }
  };

  const handleSetKeyStatus = async (id: string, name: string, status: 'active'|'disabled') => {
    const verb = status === 'disabled' ? 'disable' : 'enable';
    if (!confirm(`Are you sure you want to ${verb} Gateway key "${name}"?`)) return;
    try {
      const res = await fetch(`/api/gateway/keys/${id}/status`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status}) });
      if (!res.ok) throw new Error((await res.json()).message || 'Failed to update key status');
      onRefresh();
    } catch (err:any) { alert(err.message || 'Failed to update key status'); }
  };

  const handleRenameKey = async (id: string, current: string) => {
    const next = window.prompt('Rename this Gateway key', current);
    if (next == null) return;
    const keyName = next.trim();
    if (!keyName || keyName === current) return;
    try {
      const res = await fetch(`/api/gateway/keys/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Rename failed');
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Rename failed');
    }
  };

  const handleRevokeKey = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to permanently revoke key "${name}"? All external AI requests using it will fail immediately.`)) {
      return;
    }
    try {
      await fetch(`/api/gateway/keys/${id}/revoke`, { method: 'POST' });
      onRefresh();
    } catch {
      alert('Failed to revoke key');
    }
  };

  const handleApproveRequest = async (id: string) => {
    try {
      const permissions = requestPermissions[id];
      const res = await fetch(`/api/gateway/requests/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(permissions ? { permissions } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to approve request');
      alert('Token request approved and imported into the encrypted vault.');
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to approve request');
    }
  };

  const handleRejectRequest = async (id: string) => {
    try {
      await fetch(`/api/gateway/requests/${id}/reject`, { method: 'POST' });
      onRefresh();
    } catch {
      alert('Failed to reject request');
    }
  };

  const updateAccessScope = async (patch: Partial<GatewayKey>) => {
    if (!selectedKey) return;
    try {
      const res = await fetch(`/api/gateway/keys/${selectedKey.id}/access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Failed to update scope');
      onRefresh();
    } catch (err: any) { alert(err.message || 'Failed to update access scope'); }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Secure Gateway & External AI Access</h2>
          <p className="text-xs text-slate-400 mt-1">
            Allow external AI agents to perform authorized actions without exposing your raw credentials.
          </p>
        </div>
        <button
          onClick={onOpenCreateKeyModal}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer shadow-sm transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Create Gateway Key</span>
        </button>
      </div>

      {/* Navigation Tabs (Requirement 68) */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2 text-xs">
        {[
          { id: 'keys', label: `Gateway Keys (${keys.length})` },
          { id: 'connections', label: 'API Connections' },
          { id: 'permissions', label: 'Live Permission Matrix' },
          { id: 'requests', label: `Access Requests (${tokenRequests.filter((r) => r.status === 'pending').length})` },
          { id: 'capabilities', label: 'Capabilities Catalog' },
          { id: 'logs', label: 'API Logs' },
          { id: 'docs', label: 'API Docs' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as any)}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
              tab === t.id
                ? 'bg-indigo-600/15 text-indigo-400 font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Gateway Keys */}
      {tab === 'keys' && (
        <div className="space-y-4">
          {keys.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-500 text-xs">
              <KeyRound className="w-8 h-8 mx-auto text-slate-600 mb-3" />
              <p className="text-sm font-medium text-slate-300">No Gateway keys created yet</p>
              <p className="mt-1 max-w-sm mx-auto">
                Create a Gateway key to give external AI agents granular, capability-governed access to your accounts.
              </p>
              <button
                onClick={onOpenCreateKeyModal}
                className="mt-4 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
              >
                Create First Key
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {keys.map((k) => (
                <div
                  key={k.id}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-4 shadow-sm"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-100">{k.keyName}</h4>
                        <p className="text-xs text-slate-400 mt-0.5">{k.description || 'External AI Agent'}</p>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-medium capitalize ${
                          k.status === 'active'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-rose-500/10 text-rose-400'
                        }`}
                      >
                        {k.status}
                      </span>
                    </div>

                    <div className="mt-4 p-3 rounded-lg bg-slate-950/70 border border-slate-800/80 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between text-slate-400"><span>Stored secret:</span><span className="font-mono text-slate-300 text-[11px]">{k.keyPrefix}••••{k.keyLast4}</span></div>
                      <div className="flex items-center justify-between text-slate-400"><span>Rate limit:</span><span className="font-mono text-slate-300">{k.rateLimit} / min</span></div>
                      <div className="flex items-center justify-between text-slate-400"><span>Remaining this minute:</span><span className="font-mono text-slate-300">{typeof k.rateRemaining === 'number' ? `${k.rateRemaining} / ${k.rateLimit}` : `${k.rateLimit} / ${k.rateLimit}`}</span></div>
                      <div className="flex items-center justify-between text-slate-400"><span>Expires:</span><span className="font-mono text-slate-300 text-[11px]">{k.expiresAt ? new Date(k.expiresAt).toLocaleString() : 'No expiry'}</span></div>
                      <div className="flex items-center justify-between text-slate-400"><span>Created:</span><span className="font-mono text-slate-300 text-[11px]">{k.createdAt ? new Date(k.createdAt).toLocaleString() : '—'}</span></div>
                      <div className="flex items-center justify-between text-slate-400"><span>Last used:</span><span className="font-mono text-slate-300 text-[11px]">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never'}</span></div>
                      <div className="flex items-center justify-between text-slate-400"><span>Checked:</span><span className="font-mono text-slate-300 text-[11px]">{new Date().toLocaleDateString()}</span></div>
                      <div className="flex items-center justify-between text-slate-400"><span>Permission revision:</span><span className="font-mono text-indigo-400 font-semibold">v{k.permissionVersion || 1}</span></div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
                    <button
                      onClick={() => {
                        setSelectedKeyId(k.id);
                        setTab('permissions');
                      }}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
                    >
                      Edit Live Permissions &rarr;
                    </button>
                    <div className="flex items-center gap-3">
                      <button onClick={() => handleRenameKey(k.id, k.keyName)} className="text-xs text-slate-500 hover:text-indigo-300 cursor-pointer">Rename</button>
                      {(k.status === 'active' || k.status === 'disabled') && <button onClick={() => handleSetKeyStatus(k.id, k.keyName, k.status === 'active' ? 'disabled' : 'active')} className="text-xs text-slate-500 hover:text-indigo-300 cursor-pointer">{k.status === 'active' ? 'Disable' : 'Enable'}</button>}
                      {k.status === 'active' && (
                        <button
                          onClick={() => handleRevokeKey(k.id, k.keyName)}
                          className="text-xs text-slate-500 hover:text-rose-400 cursor-pointer"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'connections' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs text-slate-400">These are the real provider connections available to the owner workspace. Secrets are never shown; descriptions and current health metadata are safe for external-AI discovery.</div>
          {accounts.length ? <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{accounts.map((a) => <div key={a.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold text-slate-100">{a.accountName}</div><div className="text-[10px] uppercase font-mono text-slate-500 mt-0.5">{a.provider}</div></div><span className={a.status==='valid'||a.status==='connected'?'text-emerald-400':'text-amber-400'}>{a.status}</span></div><div className="text-[11px] text-slate-400">{a.description || 'No description set.'}</div><div className="text-[11px] text-slate-500">How to use: {a.howToUse || 'Use only capabilities granted to the connection and Gateway key.'}</div><div className="flex items-center justify-between text-[10px] text-slate-600"><span>{a.username || a.accountId || 'identity unavailable'}</span><span>Checked {a.lastCheckedAt ? new Date(a.lastCheckedAt).toLocaleString() : 'never'}</span></div></div>)}</div> : <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center text-slate-500 text-xs">No provider connections have been added yet.</div>}
        </div>
      )}

      {/* Tab 2: Live Permission Matrix (Requirement 26 & 69) */}
      {tab === 'permissions' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Managing Permissions for:</span>
                <select
                  value={selectedKey?.id}
                  onChange={(e) => setSelectedKeyId(e.target.value)}
                  className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs font-semibold text-slate-100"
                >
                  {keys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.keyName} ({k.keyPrefix}...{k.keyLast4})
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[11px] text-emerald-400 mt-1">
                ✓ CRITICAL RULE: The API key string remains the same. Toggling any capability takes effect immediately on the very next request.
              </p>
            </div>
            <div className="text-right text-xs">
              <span className="text-slate-500">Current Revision: </span>
              <span className="font-mono text-indigo-400 font-bold">v{selectedKey?.permissionVersion || 1}</span>
            </div>
          </div>

          {/* Capabilities Grid grouped by provider */}
          {['github', 'render', 'browser'].map((group) => {
            const groupCaps = SYSTEM_CAPABILITIES.filter((c) => c.group === group);
            return (
              <div key={group} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider capitalize">
                  {group} Capabilities
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {groupCaps.map((cap) => {
                    const isGranted = selectedKey?.capabilities?.[cap.id] === true;
                    return (
                      <div
                        key={cap.id}
                        className={`p-3 rounded-lg border text-xs flex items-start justify-between gap-3 transition-colors ${
                          isGranted
                            ? 'bg-slate-950 border-indigo-500/50 text-slate-200'
                            : 'bg-slate-950/40 border-slate-800/80 text-slate-500'
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="font-medium text-slate-200">{cap.name}</div>
                          <div className="font-mono text-[10px] text-slate-400">{cap.id}</div>
                          <div className="text-[11px] text-slate-400">{cap.description}</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={isGranted}
                          disabled={lockedCapabilities.has(cap.id)}
                          onChange={() => { if (!lockedCapabilities.has(cap.id)) void handleToggleCapability(cap.id); }}
                          className="mt-1 w-4 h-4 rounded text-indigo-600 focus:ring-0 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">Resource Scope</h3>
              <p className="text-[11px] text-slate-500 mt-1">An empty list means all resources allowed by this key. To restrict access, turn on the matching restriction and select exact resources.</p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between"><div className="text-xs font-medium text-slate-300">Providers</div><label className="text-[11px] text-slate-400 flex items-center gap-1.5"><input type="checkbox" checked={!!selectedKey?.allowedProviders?.length} onChange={(e)=>updateAccessScope({allowedProviders:e.target.checked?['github','render','cloudflare','vercel','netlify','supabase','digitalocean']:[]})}/> Restrict</label></div>
                {selectedKey?.allowedProviders?.length ? ['github','render','cloudflare','vercel','netlify','supabase','digitalocean'].map((provider) => <label key={provider} className="flex items-center gap-2 text-[11px] text-slate-400"><input type="checkbox" checked={selectedKey.allowedProviders.includes(provider)} onChange={(e)=>{ const next=e.target.checked?Array.from(new Set([...selectedKey.allowedProviders,provider])):selectedKey.allowedProviders.filter((x)=>x!==provider); updateAccessScope({allowedProviders:next}); }} /> {provider}</label>) : <div className="text-[11px] text-slate-500">All connected providers</div>}
              </div>
              <div className="space-y-2 lg:col-span-2">
                <div className="flex items-center justify-between"><div className="text-xs font-medium text-slate-300">Connected Accounts</div><label className="text-[11px] text-slate-400 flex items-center gap-1.5"><input type="checkbox" checked={!!selectedKey?.allowedAccounts?.length} onChange={(e)=>updateAccessScope({allowedAccounts:e.target.checked?accounts.map((x)=>x.id):[]})}/> Restrict</label></div>
                {selectedKey?.allowedAccounts?.length ? (accounts.length ? accounts.map((a) => <label key={a.id} className="flex items-center gap-2 p-2 rounded-lg border border-slate-800 bg-slate-950/50 text-xs text-slate-300"><input type="checkbox" checked={selectedKey.allowedAccounts.includes(a.id) || (!!a.accountId && selectedKey.allowedAccounts.includes(a.accountId))} onChange={(e)=>{ const next=e.target.checked?Array.from(new Set([...selectedKey.allowedAccounts,a.id])):selectedKey.allowedAccounts.filter((x)=>x!==a.id && x!==(a.accountId||'')); updateAccessScope({allowedAccounts:next}); }} /><span>{a.provider.toUpperCase()} · {a.accountName}</span><span className="ml-auto text-[10px] text-slate-500">{a.username || a.accountId || 'connected'}</span></label>) : <div className="text-[11px] text-slate-500">No provider accounts connected.</div>) : <div className="text-[11px] text-slate-500">All connected accounts</div>}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2"><div className="text-xs font-medium text-slate-300">Browser Sessions</div><label className="text-[11px] text-slate-400 flex items-center gap-1.5"><input type="checkbox" checked={!!selectedKey?.allowedBrowserSessions?.length} onChange={(e)=>updateAccessScope({allowedBrowserSessions:e.target.checked?browserSessions.map((x)=>x.id):[]})}/> Restrict</label></div>
              {selectedKey?.allowedBrowserSessions?.length ? (browserSessions.length ? <div className="grid grid-cols-1 md:grid-cols-2 gap-2">{browserSessions.map((s)=> <label key={s.id} className="flex items-center gap-2 p-2 rounded-lg border border-slate-800 bg-slate-950/50 text-xs text-slate-300"><input type="checkbox" checked={selectedKey.allowedBrowserSessions.includes(s.id)} onChange={(e)=>{ const next=e.target.checked?Array.from(new Set([...selectedKey.allowedBrowserSessions,s.id])):selectedKey.allowedBrowserSessions.filter((x)=>x!==s.id); updateAccessScope({allowedBrowserSessions:next}); }} /><span>{s.sessionName}</span><span className="ml-auto text-[10px] text-slate-500">{s.status}</span></label>)}</div> : <div className="text-[11px] text-slate-500">No browser sessions connected.</div>) : <div className="text-[11px] text-slate-500">All browser sessions (subject to browser capabilities)</div>}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Access Requests (Requirement 22 & 140) */}
      {tab === 'requests' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400">
            When an external AI discovers or generates a new API token during browser automation, it submits a secure token request here. It is never added silently.
          </div>

          {tokenRequests.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-500 text-xs">
              <Inbox className="w-8 h-8 mx-auto text-slate-600 mb-3" />
              <p className="text-sm font-medium text-slate-300">No pending token acquisition requests</p>
            </div>
          ) : (
            <div className="space-y-3">
              {tokenRequests.map((req) => (
                <div
                  key={req.id}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs shadow-sm"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-100">{req.name}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-slate-800 text-slate-300">
                        {req.provider}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] capitalize font-medium ${
                          req.status === 'pending'
                            ? 'bg-amber-500/10 text-amber-400'
                            : req.status === 'approved'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-rose-500/10 text-rose-400'
                        }`}
                      >
                        {req.status}
                      </span>
                    </div>
                    <div className="text-slate-400">
                      Requested by: <span className="text-slate-200">{req.requestedBy}</span> • Account: {req.account}
                    </div>
                    {req.description && <div className="text-slate-500">{req.description}</div>}
                    {req.howToUse && <div className="text-slate-600">How to use: {req.howToUse}</div>}
                    {req.status === 'pending' && (
                      <div className="mt-3 pt-3 border-t border-slate-800/70">
                        <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Requested capabilities — review before approval</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {(SYSTEM_CAPABILITIES.filter((cap) => req.requestedPermissions?.includes(cap.id) && !lockedCapabilities.has(cap.id))).map((cap) => {
                            const current = requestPermissions[req.id] || req.requestedPermissions || [];
                            const checked = current.includes(cap.id);
                            return (
                              <label key={cap.id} className="flex items-start gap-2 p-2 rounded-lg border border-slate-800 bg-slate-950/50 text-[11px] text-slate-400 cursor-pointer">
                                <input type="checkbox" checked={checked} onChange={(e) => setRequestPermissions((prev) => ({ ...prev, [req.id]: e.target.checked ? Array.from(new Set([...current, cap.id])) : current.filter((x) => x !== cap.id) }))} className="mt-0.5 accent-indigo-600" />
                                <span><span className="block text-slate-300">{cap.name}</span><span className="font-mono text-[9px] text-slate-600">{cap.id}</span></span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {req.status === 'pending' && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleRejectRequest(req.id)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => handleApproveRequest(req.id)}
                        className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium cursor-pointer shadow-xs"
                      >
                        Approve & Vault
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Capabilities Catalog */}
      {tab === 'capabilities' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 border-b border-slate-800 text-[11px] uppercase font-semibold text-slate-400">
              <tr>
                <th className="py-3 px-4">Group</th>
                <th className="py-3 px-4">Capability ID</th>
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4">Description</th>
                <th className="py-3 px-4">Risk Level</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-slate-300">
              {SYSTEM_CAPABILITIES.map((c) => (
                <tr key={c.id} className="hover:bg-slate-800/30">
                  <td className="py-3 px-4 uppercase font-mono text-[10px] text-slate-500">{c.group}</td>
                  <td className="py-3 px-4 font-mono text-indigo-400">{c.id}</td>
                  <td className="py-3 px-4 font-semibold text-slate-200">{c.name}</td>
                  <td className="py-3 px-4 text-slate-400">{c.description}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        c.riskLevel === 'high'
                          ? 'bg-rose-500/10 text-rose-400'
                          : c.riskLevel === 'medium'
                          ? 'bg-amber-500/10 text-amber-400'
                          : 'bg-emerald-500/10 text-emerald-400'
                      }`}
                    >
                      {c.riskLevel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'logs' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-800 text-xs text-slate-400">Workspace API activity. Use Activity Logs for the full audit view; this tab keeps Gateway-related requests close to the key controls.</div>
          <div className="divide-y divide-slate-800/80">{apiLogs.filter((l)=>!!l.gatewayKeyId || String(l.operation).startsWith('GATEWAY ')).slice(0,150).map((l)=><div key={l.id} className="p-3 flex items-start gap-3 text-xs"><div className={l.status==='success'?'text-emerald-400':l.status==='blocked'?'text-amber-400':'text-rose-400'}>{l.status}</div><div className="min-w-0 flex-1"><div className="font-mono text-slate-200 break-all">{l.operation}</div><div className="text-[10px] text-slate-500 mt-0.5">{l.actor} · {l.provider || 'system'}{l.target ? ` · ${l.target}` : ''} · {new Date(l.timestamp).toLocaleString()}</div>{l.safeErrorMessage&&<div className="text-[10px] text-amber-400 mt-1">{l.safeErrorMessage}</div>}</div></div>)}</div>
        </div>
      )}

      {/* Tab 5: API Documentation & OpenAPI */}
      {tab === 'docs' && (
        <div className="space-y-6 text-xs">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-indigo-400" />
              <span>External AI Gateway API Specification (v1)</span>
            </h3>
            <p className="text-slate-400">
              Live control center: {appOrigin()}. Connect a Gateway key as a Bearer token. Own AI Brain stays not configured until you attach a local brain.
            </p>
            <div className="p-3 rounded-lg bg-slate-950 font-mono text-[11px] text-slate-300 flex items-center justify-between">
              <span>Base URL: {appOrigin()}/v1</span>
              <button
                onClick={() => handleCopy(`${appOrigin()}/v1`)}
                className="text-indigo-400 hover:text-indigo-300"
              >
                Copy
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between text-slate-300 font-semibold">
                <span>cURL (Discover Capabilities)</span>
                <button
                  onClick={() => handleCopy(`curl -X GET ${appOrigin()}/v1/capabilities \\\n  -H "Authorization: Bearer gw_xxxxxxxxxxxx"`)}
                  className="text-slate-400 hover:text-white"
                >
                  {copiedText ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <pre className="p-3 rounded-lg bg-slate-950 text-slate-300 font-mono text-[11px] overflow-x-auto">{`curl -X GET ${appOrigin()}/v1/capabilities \\
  -H "Authorization: Bearer gw_xxxxxxxxxxxx" \\
  -H "Content-Type: application/json"`}</pre>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between text-slate-300 font-semibold">
                <span>JavaScript / TypeScript (Submit Task)</span>
                <button
                  onClick={() => handleCopy(`await fetch('${appOrigin()}/v1/tasks', { method: 'POST', headers: { Authorization: 'Bearer gw_xxxxxxxxxxxx', 'Content-Type': 'application/json' }, body: JSON.stringify({ request: 'List my accounts' }) })`)}
                  className="text-slate-400 hover:text-white"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              <pre className="p-3 rounded-lg bg-slate-950 text-slate-300 font-mono text-[11px] overflow-x-auto">{`const response = await fetch('${appOrigin()}/v1/tasks', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer gw_xxxxxxxxxxxx',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    request: 'List my connected accounts'
  })
});
const { taskId } = await response.json();`}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
