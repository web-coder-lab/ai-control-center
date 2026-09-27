import React, { useEffect, useMemo, useState } from 'react';
import { X, KeyRound, Copy, Check, ShieldAlert } from 'lucide-react';
import { SYSTEM_CAPABILITIES } from '../../shared/capabilities.js';

interface CreateGatewayKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const lockedCapabilities = new Set([
  'browser.download',
  'browser.upload',
  'browser.cookie.read',
  'browser.cookie.write',
  'browser.cookie.delete',
  'browser.storage.read',
  'browser.storage.write',
  'browser.password.read',
  'browser.permission.grant',
]);

export const CreateGatewayKeyModal: React.FC<CreateGatewayKeyModalProps> = ({ isOpen, onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [rateLimit, setRateLimit] = useState(60);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [accounts, setAccounts] = useState<Array<{ id:string; provider:string; accountName:string; accountId?:string }>>([]);
  const [browserSessions, setBrowserSessions] = useState<Array<{ id:string; sessionName:string; status:string }>>([]);
  const [allowedProviders, setAllowedProviders] = useState<string[]>([]);
  const [allowedAccounts, setAllowedAccounts] = useState<string[]>([]);
  const [allowedBrowserSessions, setAllowedBrowserSessions] = useState<string[]>([]);
  const [providerScopeMode, setProviderScopeMode] = useState<'all'|'restricted'>('all');
  const [accountScopeMode, setAccountScopeMode] = useState<'all'|'restricted'>('all');
  const [browserScopeMode, setBrowserScopeMode] = useState<'all'|'restricted'>('all');
  const [expireMode, setExpireMode] = useState<'none' | 'custom'>('none');
  const [expireLocal, setExpireLocal] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setDesc('');
    setRateLimit(60);
    setRawKey(null);
    setCopied(false);
    setCapabilities(defaultCapabilities);
    setAllowedProviders([]);
    setAllowedAccounts([]);
    setAllowedBrowserSessions([]);
    setProviderScopeMode('all');
    setAccountScopeMode('all');
    setBrowserScopeMode('all');
    setExpireMode('none');
    setExpireLocal('');
    Promise.all([fetch('/api/accounts').then((r) => r.json()), fetch('/api/browser/sessions').then((r) => r.json())])
      .then(([a,b]) => { setAccounts(a.accounts || []); setBrowserSessions(b.sessions || []); })
      .catch(() => {});
  }, [isOpen]);
  const defaultCapabilities = useMemo(
    () => Object.fromEntries(SYSTEM_CAPABILITIES.filter((c) => !lockedCapabilities.has(c.id)).map((c) => [c.id, false])),
    []
  );
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>(defaultCapabilities);

  if (!isOpen) return null;

  const reset = () => {
    setName(''); setDesc(''); setRateLimit(60); setRawKey(null); setCopied(false); setCapabilities(defaultCapabilities); setAllowedProviders([]); setAllowedAccounts([]); setAllowedBrowserSessions([]); setProviderScopeMode('all'); setAccountScopeMode('all'); setBrowserScopeMode('all'); setExpireMode('none'); setExpireLocal('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const providers = providerScopeMode === 'restricted' && allowedProviders.length ? allowedProviders : [];
    const accountsScope = accountScopeMode === 'restricted' && allowedAccounts.length ? allowedAccounts : [];
    const browsersScope = browserScopeMode === 'restricted' && allowedBrowserSessions.length ? allowedBrowserSessions : [];
    setIsLoading(true);
    try {
      const res = await fetch('/api/gateway/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyName: name.trim(),
          description: desc.trim() || undefined,
          rateLimit,
          capabilities,
          allowedProviders: providers,
          allowedAccounts: accountsScope,
          allowedBrowserSessions: browsersScope,
          expiresAt: expireMode === 'custom' && expireLocal ? new Date(expireLocal).toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to create Gateway key.');
      setRawKey(data.rawKey);
      onCreated();
    } catch (err: any) {
      alert(err.message || 'Failed to create Gateway key');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => { reset(); onClose(); };
  const handleCopy = async () => {
    if (!rawKey) return;
    await navigator.clipboard.writeText(rawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const grouped = ['github', 'render', 'browser', 'system'].map((group) => ({
    group,
    items: SYSTEM_CAPABILITIES.filter((c) => c.group === group && !lockedCapabilities.has(c.id)),
  })).filter((g) => g.items.length);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-5 shadow-xl space-y-4 text-xs animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-indigo-400" />
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Create Gateway API Key</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">The key stays the same when you edit permissions later.</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1 rounded text-slate-400 hover:text-slate-200" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {rawKey ? (
          <div className="space-y-4">
            <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-200 space-y-2">
              <div className="flex items-center gap-2 font-semibold"><ShieldAlert className="w-4 h-4 text-amber-400" /><span>Save this key now</span></div>
              <p className="text-[11px] text-amber-300/90 leading-relaxed">The full Gateway key is shown once. It will not be displayed again by the dashboard.</p>
            </div>
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
              <code className="font-mono text-indigo-400 text-xs break-all select-all">{rawKey}</code>
              <button onClick={handleCopy} className="p-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 shrink-0" aria-label="Copy Gateway key">
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <button onClick={handleClose} className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-xs">Done</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block"><span className="block text-slate-300 font-medium mb-1">Key Name</span>
                <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kiro-Agent" className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200" />
              </label>
              <label className="block"><span className="block text-slate-300 font-medium mb-1">Rate Limit</span>
                <input type="number" min="1" max="1000000" value={rateLimit} onChange={(e) => setRateLimit(Math.max(1, Math.min(1000000, Number(e.target.value) || 1)))} className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200" />
              </label>
            </div>
            <label className="block"><span className="block text-slate-400 font-medium mb-1">Description</span>
              <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What is this key used for?" className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200" />
            </label>
            <div className="space-y-2">
              <span className="block text-slate-400 font-medium">Expiration</span>
              <div className="flex gap-3 text-slate-300">
                <label className="flex items-center gap-2"><input type="radio" checked={expireMode === 'none'} onChange={() => { setExpireMode('none'); setExpireLocal(''); }} /> No expiry</label>
                <label className="flex items-center gap-2"><input type="radio" checked={expireMode === 'custom'} onChange={() => setExpireMode('custom')} /> Set date and time</label>
              </div>
              {expireMode === 'custom' && (
                <input
                  type="datetime-local"
                  value={expireLocal}
                  onChange={(e) => setExpireLocal(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                />
              )}
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-200">Resource scope</h4>
                <p className="text-[11px] text-slate-500 mt-1">Choose which provider accounts this key can use. Leave a category on All to allow every connected resource that the key's capabilities permit.</p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={providerScopeMode === 'restricted'} onChange={(e) => { setProviderScopeMode(e.target.checked ? 'restricted' : 'all'); if (!e.target.checked) setAllowedProviders([]); }} /> Restrict providers</label>
                  {providerScopeMode === 'restricted' && ['github','render','cloudflare','vercel','netlify','supabase','digitalocean'].map((provider) => <label key={provider} className="flex items-center gap-2 text-[11px] text-slate-400"><input type="checkbox" checked={allowedProviders.includes(provider)} onChange={(e) => setAllowedProviders((prev) => e.target.checked ? [...new Set([...prev, provider])] : prev.filter((x) => x !== provider))} /> {provider}</label>)}
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={accountScopeMode === 'restricted'} onChange={(e) => { setAccountScopeMode(e.target.checked ? 'restricted' : 'all'); if (!e.target.checked) setAllowedAccounts([]); }} /> Restrict accounts</label>
                  {accountScopeMode === 'restricted' && accounts.map((a) => <label key={a.id} className="flex items-center gap-2 text-[11px] text-slate-400"><input type="checkbox" checked={allowedAccounts.includes(a.id)} onChange={(e) => setAllowedAccounts((prev) => e.target.checked ? [...new Set([...prev, a.id])] : prev.filter((x) => x !== a.id))} /> {a.provider.toUpperCase()} · {a.accountName}</label>)}
                  {accountScopeMode === 'restricted' && !accounts.length && <div className="text-[11px] text-slate-500">No connected accounts yet.</div>}
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={browserScopeMode === 'restricted'} onChange={(e) => { setBrowserScopeMode(e.target.checked ? 'restricted' : 'all'); if (!e.target.checked) setAllowedBrowserSessions([]); }} /> Restrict browsers</label>
                  {browserScopeMode === 'restricted' && browserSessions.map((s) => <label key={s.id} className="flex items-center gap-2 text-[11px] text-slate-400"><input type="checkbox" checked={allowedBrowserSessions.includes(s.id)} onChange={(e) => setAllowedBrowserSessions((prev) => e.target.checked ? [...new Set([...prev, s.id])] : prev.filter((x) => x !== s.id))} /> {s.sessionName} <span className="text-slate-600">({s.status})</span></label>)}
                  {browserScopeMode === 'restricted' && !browserSessions.length && <div className="text-[11px] text-slate-500">No browser sessions yet.</div>}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-200">Initial capabilities</h4>
                <p className="text-[11px] text-slate-500 mt-1">Choose what this Gateway key can do. You can change these permissions later without creating another key.</p>
              </div>
              {grouped.map(({ group, items }) => (
                <div key={group}>
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">{group}</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {items.map((cap) => {
                      const checked = capabilities[cap.id] === true;
                      return <label key={cap.id} className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-900/70 p-2.5 cursor-pointer hover:border-slate-700">
                        <input type="checkbox" checked={checked} onChange={(e) => setCapabilities((prev) => ({ ...prev, [cap.id]: e.target.checked }))} className="mt-0.5 h-3.5 w-3.5 accent-indigo-600" />
                        <span className="min-w-0"><span className="block text-[11px] font-medium text-slate-200">{cap.name}</span><span className="block text-[10px] leading-4 text-slate-500">{cap.description}</span></span>
                      </label>;
                    })}
                  </div>
                </div>
              ))}
              <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-3">
                <p className="text-[10px] text-amber-200/80"><strong>Locked by browser security policy:</strong> downloads, uploads, cookie access, browser storage, password extraction and browser permission grants are not exposed through the Gateway.</p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
              <button type="button" onClick={handleClose} className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300">Cancel</button>
              <button type="submit" disabled={isLoading} className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium disabled:opacity-50">{isLoading ? 'Creating…' : 'Create Key'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
