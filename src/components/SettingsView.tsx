import React, { useState, useEffect } from 'react';
import {
  Settings,
  Shield,
  CheckCircle2,
  AlertCircle,
  Save,
  Lock,
  Stethoscope,
  KeyRound,
  Zap,
} from 'lucide-react';
import type { ProviderConnection, GatewayKey } from '../../shared/types.js';

interface SettingsViewProps {
  accounts: ProviderConnection[];
  keys: GatewayKey[];
  onOpenSelfTest: () => void;
  onRefresh: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  accounts,
  keys,
  onOpenSelfTest,
  onRefresh,
}) => {
  const [costPolicy, setCostPolicy] = useState('ask-before-paid');
  const [autoFix, setAutoFix] = useState(false);
  const [retentionDays, setRetentionDays] = useState(90);
  const [executionApprovalMode, setExecutionApprovalMode] = useState('ask_dangerous');
  const [agentSecretConfigured, setAgentSecretConfigured] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    fetch('/api/system/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setCostPolicy(d.settings.costPolicy || 'ask-before-paid');
          setAutoFix(d.settings.autoFix || false);
          setRetentionDays(d.settings.retentionDays || 90);
          setExecutionApprovalMode(d.settings.executionApprovalMode || 'ask_dangerous');
          setAgentSecretConfigured(Boolean(d.settings.browserAgentSharedSecretConfigured));
        }
      });
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const res = await fetch('/api/system/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          costPolicy,
          autoFix,
          retentionDays,
          executionApprovalMode,
        }),
      });
      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
      }
    } catch {
      alert('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const hasGithub = accounts.some((a) => a.provider === 'github');
  const hasRender = accounts.some((a) => a.provider === 'render');
  const hasKey = keys.length > 0;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 text-xs">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Settings & Security Governance</h2>
        <p className="text-slate-400 mt-1">
          Configure security boundaries, cost policies, browser-agent pairing, and inspect the real system checklist.
        </p>
      </div>

      {/* Setup Checklist (Requirement 253) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Shield className="w-4 h-4 text-indigo-400" />
          <span>In-App Setup Checklist (Real State)</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
            <span className="text-slate-300">Database Engine</span>
            <span className="text-[10px] text-slate-500">PostgreSQL runtime</span>
          </div>
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
            <span className="text-slate-300">AES-256 Vault</span>
            <span className="text-[10px] text-slate-500">Configured at runtime</span>
          </div>
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
            <span className="text-slate-300">Own AI Brain</span>
            <span className="text-[10px] text-amber-400">Not installed</span>
          </div>
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
            <span className="text-slate-300">GitHub Provider</span>
            {hasGithub ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 text-slate-600" />
            )}
          </div>
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
            <span className="text-slate-300">Render Provider</span>
            {hasRender ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 text-slate-600" />
            )}
          </div>
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
            <span className="text-slate-300">Google access</span>
            <span className="text-[10px] text-slate-500">Browser session only</span>
          </div>
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
            <span className="text-slate-300">Browser Agent Secret</span>
            {agentSecretConfigured ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-amber-400" />}
          </div>
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
            <span className="text-slate-300">First Gateway Key</span>
            {hasKey ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 text-slate-600" />
            )}
          </div>
        </div>
      </div>

      {/* Main Settings Form */}
      <form onSubmit={handleSave} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-100">Global Governance Policies</h3>

        {/* Cost Policy (Requirement 63) */}
        <div>
          <label className="block text-slate-300 font-medium mb-1">Cost & Payment Guard Policy</label>
          <select
            value={costPolicy}
            onChange={(e) => setCostPolicy(e.target.value)}
            className="w-full sm:w-80 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
          >
            <option value="free-only">Free Only (Strictly block any paid operations)</option>
            <option value="ask-before-paid">Ask Before Paid (Pause and require human approval)</option>
            <option value="paid-allowed">Paid Allowed (Allow authorized paid resource creation)</option>
          </select>
          <p className="text-[11px] text-slate-500 mt-1">
            Controls automated actions that could incur provider charges (for example, Render paid plans).
          </p>
        </div>

        <div>
          <label className="block text-slate-300 font-medium mb-1">Execution Approval Mode</label>
          <select value={executionApprovalMode} onChange={(e) => setExecutionApprovalMode(e.target.value)} className="w-full sm:w-80 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200">
            <option value="auto_safe">Auto safe actions</option>
            <option value="ask_dangerous">Ask for dangerous actions</option>
            <option value="ask_all">Ask before every action</option>
          </select>
          <p className="text-[11px] text-slate-500 mt-1">Delete, payment, production changes and other dangerous actions can require owner confirmation.</p>
        </div>

        {/* AI Auto-Fix (Requirement 15) */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800 max-w-xl">
          <div>
            <div className="font-semibold text-slate-200">AI Self-Repair / Auto-Fix</div>
            <div className="text-[11px] text-slate-400">
              Allow the AI to author fix commits when build failures occur. (Default: OFF for production safety)
            </div>
          </div>
          <input
            type="checkbox"
            checked={autoFix}
            onChange={(e) => setAutoFix(e.target.checked)}
            className="w-4 h-4 rounded text-indigo-600 cursor-pointer"
          />
        </div>

        {/* Browser Agent Pairing Secret */}
        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-slate-200">Browser Agent Pairing</div>
              <div className="text-[11px] text-slate-500 mt-1">The shared secret stays server-side and is never displayed in the dashboard.</div>
            </div>
            <span className={`text-[10px] font-semibold ${agentSecretConfigured ? 'text-emerald-400' : 'text-amber-400'}`}>
              {agentSecretConfigured ? 'CONFIGURED' : 'NOT CONFIGURED'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Set <code className="font-mono text-slate-300">BROWSER_AGENT_SHARED_SECRET</code> in the server environment, then use the same value only in the local browser-agent process.</p>
        </div>

        {/* Audit Log Retention */}
        <div>
          <label className="block text-slate-300 font-medium mb-1">Activity Log Retention</label>
          <select
            value={retentionDays}
            onChange={(e) => setRetentionDays(parseInt(e.target.value, 10))}
            className="w-full sm:w-60 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
          >
            <option value={30}>30 Days</option>
            <option value={90}>90 Days</option>
            <option value={365}>1 Year</option>
          </select>
        </div>

        <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={onOpenSelfTest}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-400 font-medium cursor-pointer"
          >
            <Stethoscope className="w-3.5 h-3.5" />
            <span>Run System Self-Test</span>
          </button>

          <div className="flex items-center gap-3">
            {saveSuccess && (
              <span className="text-emerald-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Saved successfully</span>
              </span>
            )}
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-xs disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Saving...' : 'Save Settings'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
