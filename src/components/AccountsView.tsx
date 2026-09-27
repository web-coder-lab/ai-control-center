import React, { useState } from 'react';
import {
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Shield,
  Key,
  ExternalLink,
  Lock,
} from 'lucide-react';
import type { ProviderConnection } from '../../shared/types.js';

interface AccountsViewProps {
  accounts: ProviderConnection[];
  onOpenConnectModal: () => void;
  onRefreshAccounts: () => void;
}

export const AccountsView: React.FC<AccountsViewProps> = ({
  accounts,
  onOpenConnectModal,
  onRefreshAccounts,
}) => {
  const [filter, setFilter] = useState<string>('all');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, any>>({});

  const filtered = filter === 'all' ? accounts : accounts.filter((a) => a.provider === filter);

  const handleTestConnection = async (id: string) => {
    setTestingId(id);
    try {
      const res = await fetch(`/api/accounts/${id}/test`, { method: 'POST' });
      const data = await res.json();
      setTestResult((prev) => ({ ...prev, [id]: data }));
      onRefreshAccounts();
    } catch (err: any) {
      setTestResult((prev) => ({ ...prev, [id]: { healthy: false, message: err.message } }));
    } finally {
      setTestingId(null);
    }
  };

  const handleDeleteConnection = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to remove account "${name}"? Stored credentials will be permanently destroyed.`)) {
      return;
    }
    try {
      await fetch(`/api/accounts/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) });
      onRefreshAccounts();
    } catch (err) {
      alert('Failed to remove account');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Multi-Account & Service Connections</h2>
          <p className="text-xs text-slate-400 mt-1">
            Connect multiple provider accounts. Each credential is validated against the real provider API and encrypted in the vault. All credentials are encrypted with AES-256-GCM.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={onRefreshAccounts}
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            title="Refresh accounts"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={onOpenConnectModal}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-sm transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Connect Account</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2 text-xs">
        {['all', 'github', 'render', 'cloudflare', 'vercel', 'netlify', 'supabase', 'digitalocean'].map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-3 py-1.5 rounded-lg capitalize font-medium transition-colors cursor-pointer ${
              filter === tab
                ? 'bg-indigo-600/15 text-indigo-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            {tab} {tab !== 'all' && `(${accounts.filter((a) => a.provider === tab).length})`}
          </button>
        ))}
      </div>

      {/* Accounts Grid */}
      {filtered.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-500 text-xs">
          <Shield className="w-8 h-8 mx-auto text-slate-600 mb-3" />
          <p className="text-sm font-medium text-slate-300">No {filter === 'all' ? '' : filter} accounts connected</p>
          <p className="mt-1 max-w-sm mx-auto">
            Connect your personal access tokens or OAuth credentials to allow the AI agent to manage your infrastructure safely.
          </p>
          <button
            onClick={onOpenConnectModal}
            className="mt-4 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
          >
            Connect First Account
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((acc) => {
            const res = testResult[acc.id];
            return (
              <div
                key={acc.id}
                className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-4 shadow-sm"
              >
                <div>
                  {/* Top: Avatar & Name */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {acc.avatarUrl ? (
                        <img src={acc.avatarUrl} alt="" className="w-10 h-10 rounded-full border border-slate-800" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center font-bold text-sm text-indigo-400 uppercase">
                          {acc.provider[0]}
                        </div>
                      )}
                      <div>
                        <h4 className="text-sm font-semibold text-slate-100">{acc.accountName}</h4>
                        <p className="text-xs text-slate-400 capitalize">
                          {acc.provider} {acc.username ? `• @${acc.username}` : ''}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 ${
                        acc.status === 'valid' || acc.status === 'connected'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-rose-500/10 text-rose-400'
                      }`}
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      {acc.status}
                    </span>
                  </div>

                  {/* Secret Vault Metadata (Never raw secrets) */}
                  <div className="mt-4 p-3 rounded-lg bg-slate-950/70 border border-slate-800/80 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="flex items-center gap-1 text-[11px]">
                        <Lock className="w-3 h-3 text-emerald-400" />
                        Stored Secret:
                      </span>
                      <span className="font-mono text-[11px] text-slate-300">•••• •••• {acc.tokenLast4}</span>
                    </div>
                    {acc.rateLimit && (
                      <div className="flex items-center justify-between text-slate-400 text-[11px]">
                        <span>Rate Limit Remaining:</span>
                        <span className="font-mono text-slate-300">
                          {acc.rateLimit.remaining} / {acc.rateLimit.limit}
                        </span>
                      </div>
                    )}
                    {acc.lastCheckedAt && (
                      <div className="text-[10px] text-slate-500">
                        Checked: {new Date(acc.lastCheckedAt).toLocaleDateString()}
                      </div>
                    )}
                  </div>

                  {acc.description && <div className="mt-3 text-[11px] leading-4 text-slate-500">{acc.description}</div>}
                  {acc.howToUse && <div className="mt-1 text-[11px] leading-4 text-slate-600">Use: {acc.howToUse}</div>}

                  {/* Permissions & Scopes Tags */}
                  {acc.permissions && acc.permissions.length > 0 && (
                    <div className="mt-3">
                      <div className="text-[10px] uppercase font-semibold text-slate-500 mb-1.5">
                        Detected Scopes & Capabilities:
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {acc.permissions.slice(0, 6).map((p) => (
                          <span
                            key={p}
                            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300"
                          >
                            {p}
                          </span>
                        ))}
                        {acc.permissions.length > 6 && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400">
                            +{acc.permissions.length - 6} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Test Status Banner */}
                  {res && (
                    <div
                      className={`mt-3 p-2.5 rounded-lg text-xs flex items-start gap-2 ${
                        res.healthy
                          ? 'bg-emerald-950/40 border border-emerald-800/50 text-emerald-300'
                          : 'bg-rose-950/40 border border-rose-800/50 text-rose-300'
                      }`}
                    >
                      {res.healthy ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="font-semibold">{res.healthy ? 'Connection Verified' : 'Check Failed'}</div>
                        <div className="text-[11px] mt-0.5 opacity-90">{res.message}</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Bottom Actions */}
                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
                  <button
                    onClick={() => handleTestConnection(acc.id)}
                    disabled={testingId === acc.id}
                    className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 font-medium disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${testingId === acc.id ? 'animate-spin' : ''}`} />
                    <span>{testingId === acc.id ? 'Testing...' : 'Test Connection'}</span>
                  </button>

                  <button
                    onClick={() => handleDeleteConnection(acc.id, acc.accountName)}
                    className="p-1.5 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                    title="Remove connection"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
