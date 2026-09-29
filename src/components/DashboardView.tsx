import React from 'react';
import {
  Users,
  Rocket,
  KeyRound,
  ShieldAlert,
  ArrowUpRight,
  FolderGit2,
  CheckCircle2,
  AlertTriangle,
  Play,
  Upload,
  Globe,
  RefreshCw,
} from 'lucide-react';
import type { ProviderConnection, Deployment, Task, ActivityLog } from '../../shared/types.js';

interface DashboardViewProps {
  accounts: ProviderConnection[];
  deployments: Deployment[];
  tasks: Task[];
  logs: ActivityLog[];
  keys?: { status: string; keyName?: string }[];
  onNavigate: (tab: any) => void;
  onOpenUploadZip: () => void;
  onQuickChatPrompt: (prompt: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  accounts,
  deployments,
  tasks,
  logs,
  keys = [],
  onNavigate,
  onOpenUploadZip,
  onQuickChatPrompt,
}) => {
  const activeTasks = tasks.filter((t) => t.status === 'executing' || t.status === 'planning');
  const recentLogs = logs.slice(0, 6);
  const liveDeployments = deployments.filter((d) => d.status === 'live');
  const activeKeys = keys.filter((k) => k.status === 'active');

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Banner & Quick Commands */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">AI Control Center</h2>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              Live host {typeof window !== 'undefined' ? window.location.origin : 'https://ai-control-center-5o39.onrender.com'}. Database is PostgreSQL. Own AI Brain is not configured. Gateway keys and connected accounts below are live counts, not samples.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={onOpenUploadZip}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-sm transition-colors cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Deploy ZIP Project</span>
            </button>
            <button
              onClick={() => onNavigate('chat')}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700/60 transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 text-indigo-400" />
              <span>Open AI Chat</span>
            </button>
          </div>
        </div>

        {/* Quick Action Chips (Requirement 159) */}
        <div className="mt-4 pt-4 border-t border-slate-800 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mr-1">Quick Prompts:</span>
          {[
            'Deploy this ZIP on Render',
            'Show all my GitHub repositories',
            'Check Render services',
            'System audit karo',
          ].map((prompt) => (
            <button
              key={prompt}
              onClick={() => onQuickChatPrompt(prompt)}
              className="px-2.5 py-1 rounded-md bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/50 transition-colors cursor-pointer text-[11px]"
            >
              "{prompt}"
            </button>
          ))}
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Connected Accounts */}
        <div
          onClick={() => onNavigate('accounts')}
          className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-4 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">Connected Accounts</span>
            <Users className="w-4 h-4 text-indigo-400 group-hover:translate-x-0.5 transition-transform" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-slate-100">{accounts.length}</span>
            <span className="text-xs text-slate-400">identities verified</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            {accounts.filter((a) => a.provider === 'github').length} GitHub •{' '}
            {accounts.filter((a) => a.provider === 'render').length} Render •{' '}
            Browser-only Google sessions
          </p>
        </div>

        {/* Live Deployments */}
        <div
          onClick={() => onNavigate('deployments')}
          className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-4 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">Deployments</span>
            <Rocket className="w-4 h-4 text-emerald-400 group-hover:translate-x-0.5 transition-transform" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-slate-100">{deployments.length}</span>
            <span className="text-xs text-emerald-400 font-medium">{liveDeployments.length} verified live</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Continuous build verification</p>
        </div>

        {/* Active Tasks */}
        <div
          onClick={() => onNavigate('tasks')}
          className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-4 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">Task Engine</span>
            <ArrowUpRight className="w-4 h-4 text-blue-400 group-hover:translate-x-0.5 transition-transform" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-slate-100">{tasks.length}</span>
            <span className="text-xs text-blue-400 font-medium">{activeTasks.length} in progress</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Resource locks & dry-run active</p>
        </div>

        {/* Security & Vault */}
        <div
          onClick={() => onNavigate('settings')}
          className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-4 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">Security & Guard</span>
            <KeyRound className="w-4 h-4 text-amber-400 group-hover:translate-x-0.5 transition-transform" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-slate-100">{activeKeys.length}</span>
            <span className="text-xs text-emerald-400 font-medium">gateway keys live</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Hashes never shown · owner session httpOnly</p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap gap-3 text-[11px] text-slate-400">
        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">CSP + HSTS</span>
        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">Owner cookie httpOnly</span>
        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">Login rate limit</span>
        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">Gateway handshake</span>
        <span className="px-2 py-1 rounded bg-slate-800 text-slate-300">{accounts.filter((a)=>a.provider==='github').length} GitHub accounts</span>
        <button onClick={() => onNavigate('gateway')} className="ml-auto text-indigo-400 hover:text-indigo-300">Manage keys →</button>
      </div>

      {/* Main Content Split: Recent Verified Activities & Current Account Identities */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Recent Activity Feed (2 Cols) */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-100">Live Activity Feed</h3>
            <button
              onClick={() => onNavigate('logs')}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
            >
              View Full Audit Logs &rarr;
            </button>
          </div>

          {recentLogs.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              No operations logged yet. Run your first action using AI Chat or connect an account.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80">
              {recentLogs.map((log) => (
                <div key={log.id} className="py-3 flex items-start justify-between gap-4 text-xs">
                  <div className="flex items-start gap-3">
                    <span
                      className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                        log.status === 'success'
                          ? 'bg-emerald-400'
                          : log.status === 'blocked'
                          ? 'bg-amber-400'
                          : 'bg-rose-400'
                      }`}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-200">{log.operation}</span>
                        {log.provider && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400 uppercase">
                            {log.provider}
                          </span>
                        )}
                      </div>
                      <p className="text-slate-400 text-[11px] mt-0.5">
                        Actor: {log.actor} {log.target ? `• Target: ${log.target}` : ''}
                      </p>
                      {log.safeErrorMessage && (
                        <p className="text-amber-400/90 text-[11px] mt-0.5">{log.safeErrorMessage}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 text-slate-500 text-[11px]">
                    <div>{new Date(log.timestamp).toLocaleTimeString()}</div>
                    <div className="font-mono text-[10px] text-slate-400">{log.durationMs}ms</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Connected Providers Summary */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-100">Service Connections</h3>
              <button
                onClick={() => onNavigate('accounts')}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
              >
                Manage
              </button>
            </div>

            {accounts.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs">
                No provider accounts connected.
                <button
                  onClick={() => onNavigate('accounts')}
                  className="block mx-auto mt-3 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium cursor-pointer"
                >
                  Connect First Account
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {accounts.slice(0, 5).map((acc) => (
                  <div
                    key={acc.id}
                    className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      {acc.avatarUrl ? (
                        <img src={acc.avatarUrl} alt="" className="w-6 h-6 rounded-full" />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center font-bold text-[10px] text-slate-300 uppercase">
                          {acc.provider[0]}
                        </div>
                      )}
                      <div>
                        <div className="font-medium text-slate-200">{acc.accountName}</div>
                        <div className="text-[11px] text-slate-500 capitalize">
                          {acc.provider} {acc.username ? `(@${acc.username})` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{acc.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
            <span>Secrets Encrypted</span>
            <span className="font-mono text-slate-400">AES-256-GCM</span>
          </div>
        </div>
      </div>
    </div>
  );
};
