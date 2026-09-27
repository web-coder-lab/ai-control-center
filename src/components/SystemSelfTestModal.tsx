import React, { useState, useEffect } from 'react';
import { X, Stethoscope, CheckCircle2, AlertCircle, RefreshCw, ShieldCheck } from 'lucide-react';

interface SystemSelfTestModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SystemSelfTestModal: React.FC<SystemSelfTestModalProps> = ({ isOpen, onClose }) => {
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runTest = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/system/diagnostics');
      const data = await res.json();
      if (data.success) {
        setDiagnostics(data.diagnostics);
      } else {
        setDiagnostics(null);
        setError(data.message || 'Diagnostic request failed.');
      }
    } catch (err: any) {
      setDiagnostics(null);
      setError(err?.message || 'Diagnostic request failed.');
    } finally {
      setIsRunning(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      runTest();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-5 shadow-xl space-y-4 text-xs animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-slate-100">System Self-Test & Diagnostic Audit</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        {isRunning ? (
          <div className="py-12 text-center text-slate-400 space-y-2">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin text-indigo-400" />
            <div>Running diagnostic checks across database, vault, providers, and gateway...</div>
          </div>
        ) : error ? (
          <div className="py-12 text-center text-red-300 space-y-2">
            <AlertCircle className="w-6 h-6 mx-auto" />
            <div>{error}</div>
          </div>
        ) : diagnostics ? (
          <div className="space-y-3 font-mono">
            {/* Core Services */}
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-slate-200 font-semibold">Database Persistence:</span>
                <span className="text-slate-400 text-[11px] block">{diagnostics.database.location}</span>
              </div>
              <span className={diagnostics.database.status === 'healthy' ? 'text-emerald-400 flex items-center gap-1 font-semibold' : 'text-rose-400 flex items-center gap-1 font-semibold'}>
                {diagnostics.database.status === 'healthy' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {String(diagnostics.database.status).toUpperCase()}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-slate-200 font-semibold">Secret Encryption Vault:</span>
                <span className="text-slate-400 text-[11px] block">AES-256-GCM Authenticated Encryption</span>
              </div>
              <span className={diagnostics.encryptionVault.status === 'configured' ? 'text-emerald-400 flex items-center gap-1 font-semibold' : 'text-amber-400 flex items-center gap-1 font-semibold'}>
                {diagnostics.encryptionVault.status === 'configured' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {String(diagnostics.encryptionVault.status).replace('_',' ').toUpperCase()}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-slate-200 font-semibold">Own AI Brain:</span>
                <span className="text-slate-400 text-[11px] block">Mode: {diagnostics.agent.mode || 'user-owned / self-hosted'}</span>
              </div>
              <span
                className={`flex items-center gap-1 font-semibold ${
                  diagnostics.agent.status === 'ready' ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {diagnostics.agent.status === 'ready' ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5" />
                )}
                {diagnostics.agent.status.toUpperCase()}
              </span>
            </div>

            {/* Providers Status */}
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
              <span className="text-slate-200 font-semibold block mb-1">Provider Connectors:</span>
              <div className="flex justify-between text-slate-400 text-[11px]">
                <span>GitHub:</span>
                <span className={diagnostics.providers.github.connected > 0 ? 'text-emerald-400' : 'text-slate-600'}>
                  {diagnostics.providers.github.connected > 0
                    ? `${diagnostics.providers.github.connected} Account(s) Connected`
                    : 'Not Configured'}
                </span>
              </div>
              <div className="flex justify-between text-slate-400 text-[11px]">
                <span>Render:</span>
                <span className={diagnostics.providers.render.connected > 0 ? 'text-emerald-400' : 'text-slate-600'}>
                  {diagnostics.providers.render.connected > 0
                    ? `${diagnostics.providers.render.connected} Workspace(s) Connected`
                    : 'Not Configured'}
                </span>
              </div>
              <div className="flex justify-between text-slate-400 text-[11px]">
                <span>Google:</span>
                <span className="text-slate-500">Browser session only</span>
              </div>
            </div>

            {/* Gateway & Policy */}
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-slate-200 font-semibold">Gateway & Cost Policy:</span>
                <span className="text-slate-400 text-[11px] block">
                  {diagnostics.gateway.activeKeys} Active Keys • Policy: {diagnostics.costPolicy}
                </span>
              </div>
              <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                <ShieldCheck className="w-3.5 h-3.5" />
                CONFIGURED
              </span>
            </div>
          </div>
        ) : null}

        <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
          <button
            onClick={runTest}
            disabled={isRunning}
            className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 font-medium hover:text-white"
          >
            Re-run Test
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-500 shadow-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
