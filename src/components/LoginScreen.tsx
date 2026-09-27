import React, { useState } from 'react';
import { LockKeyhole, ShieldCheck, AlertTriangle, ArrowRight } from 'lucide-react';

interface LoginScreenProps {
  configured: boolean;
  onAuthenticated: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ configured, onAuthenticated }) => {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Sign-in failed.');
      onAuthenticated();
    } catch (err: any) {
      setError(err.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-7 shadow-2xl shadow-black/20">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10">
            <LockKeyhole className="h-6 w-6 text-indigo-400" />
          </div>
          <h1 className="mt-5 text-xl font-semibold tracking-tight">AI Control Center</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">Owner-only access. Provider credentials and Gateway controls stay behind this session.</p>

          {!configured ? (
            <div className="mt-6 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                <div>
                  <p className="text-sm font-medium text-amber-200">Owner password is not configured</p>
                  <p className="mt-1 text-xs leading-5 text-amber-100/70">Set <span className="font-mono">OWNER_PASSWORD</span> to a strong unique secret in the server environment, then reload this page.</p>
                </div>
              </div>
            </div>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={submit}>
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-slate-300">Owner password</span>
                <input
                  autoFocus
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 text-sm text-slate-100 outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/10"
                  placeholder="Enter your owner password"
                />
              </label>
              {error && <p className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}
              <button
                disabled={busy || !password}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShieldCheck className="h-4 w-4" />
                {busy ? 'Signing in…' : 'Continue'}
                {!busy && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
