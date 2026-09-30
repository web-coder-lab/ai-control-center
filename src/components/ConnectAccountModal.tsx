import React, { useEffect, useState } from 'react';
import { X, Shield, Lock, AlertCircle } from 'lucide-react';
import type { ProviderType } from '../../shared/types.js';

interface ConnectAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultProvider?: ProviderType;
}

export const ConnectAccountModal: React.FC<ConnectAccountModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  defaultProvider = 'github',
}) => {
  const [provider, setProvider] = useState<ProviderType>(defaultProvider);
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [label, setLabel] = useState('');
  const [purpose, setPurpose] = useState('');
  const [description, setDescription] = useState('');
  const [howToUse, setHowToUse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setProvider(defaultProvider);
    setName('');
    setToken('');
    setLabel('');
    setPurpose('');
    setDescription('');
    setHowToUse('');
    setError(null);
    setIsLoading(false);
  }, [isOpen, defaultProvider]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !token.trim()) {
      setError('Please provide both an account name and credential token.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          name: name.trim(),
          token: token.trim(),
          label: label.trim() || undefined,
          purpose: purpose.trim() || undefined,
          description: description.trim() || undefined,
          howToUse: howToUse.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (data.success) {
        onSuccess();
        onClose();
      } else {
        setError(data.message || 'Validation failed for this credential.');
      }
    } catch (err: any) {
      setError(err.message || 'Connection request failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Connect Provider Account</h3>
              <p className="text-xs text-slate-400">Validated against real provider API & encrypted in vault</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <div>{error}</div>
            </div>
          )}

          {/* Provider Selection */}
          <div>
            <label className="block font-medium text-slate-300 mb-1.5">Select Provider</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(['github', 'render', 'cloudflare', 'vercel', 'netlify', 'supabase', 'digitalocean', 'gitdb'] as ProviderType[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className={`py-2 rounded-lg capitalize font-medium text-center border transition-colors cursor-pointer ${
                    provider === p
                      ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Connection Name */}
          <div>
            <label className="block font-medium text-slate-300 mb-1.5">Account Alias / Connection Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My Personal GitHub, Render Work Workspace"
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Token / Credential */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-medium text-slate-300 flex items-center gap-1.5">
                <Lock className="w-3 h-3 text-emerald-400" />
                <span>
                  {provider === 'github'
                    ? 'GitHub Personal Access Token (classic or fine-grained)'
                    : provider === 'render'
                    ? 'Render API Key (rnd_...)'
                    : provider === 'gitdb'
                    ? 'GitDB API key (github-store)'
                    : 'API Token / Secret'}
                </span>
              </label>
            </div>
            <input
              type="password"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste token (never stored in plaintext)"
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Backend validates token against real API and stores encrypted with AES-256-GCM. Raw token is never returned to the UI.
            </p>
          </div>

          {/* Optional Label / Purpose */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-400 mb-1.5">Label (Optional)</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Work, Staging"
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-400 mb-1.5">Purpose (Optional)</label>
              <input
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g. Production Deploys"
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block font-medium text-slate-400 mb-1.5">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this connection belongs to and why the AI may use it" rows={2} className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block font-medium text-slate-400 mb-1.5">How to use (optional)</label>
              <textarea value={howToUse} onChange={(e) => setHowToUse(e.target.value)} placeholder="Short instructions shown to external AI clients" rows={2} className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500" />
            </div>
          </div>

          {/* Submit Actions */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium disabled:opacity-50 cursor-pointer shadow-sm"
            >
              {isLoading ? 'Validating Token...' : 'Validate & Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
