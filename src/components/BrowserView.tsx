import React, { useEffect, useState } from 'react';
import {
  Globe,
  Plus,
  Play,
  Pause,
  AlertTriangle,
  Shield,
  Lock,
  Camera,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  Laptop,
} from 'lucide-react';
import type { BrowserSession, ProviderConnection } from '../../shared/types.js';

interface BrowserViewProps {
  sessions: BrowserSession[];
  onRefresh: () => void;
}

export const BrowserView: React.FC<BrowserViewProps> = ({ sessions, onRefresh }) => {
  const [selectedSessionId, setSelectedSessionId] = useState<string>(sessions[0]?.id || '');
  const [navUrl, setNavUrl] = useState('');
  const [isNavigating, setIsNavigating] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [providerAccounts, setProviderAccounts] = useState<ProviderConnection[]>([]);
  const [newProviderAccountId, setNewProviderAccountId] = useState('');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);

  const currentSession = sessions.find((s) => s.id === selectedSessionId) || sessions[0];

  useEffect(() => {
    if (!selectedSessionId && sessions[0]?.id) setSelectedSessionId(sessions[0].id);
    if (selectedSessionId && sessions.length && !sessions.some((s) => s.id === selectedSessionId)) setSelectedSessionId(sessions[0]?.id || '');
  }, [sessions, selectedSessionId]);

  useEffect(() => {
    setPairingCode(null);
    setPairingExpiresAt(null);
  }, [selectedSessionId]);

  useEffect(() => {
    void fetch('/api/accounts').then((r) => r.json()).then((data) => setProviderAccounts(Array.isArray(data.accounts) ? data.accounts : [])).catch(() => setProviderAccounts([]));
  }, []);

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSessionName.trim()) return;
    try {
      const res = await fetch('/api/browser/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionName: newSessionName.trim(), providerAccountId: newProviderAccountId || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        setShowNewModal(false);
        setNewSessionName('');
        setNewProviderAccountId('');
        onRefresh();
        setSelectedSessionId(data.session.id);
      }
    } catch {
      alert('Failed to create browser session');
    }
  };

  const handleNavigate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentSession || !navUrl.trim()) return;

    let target = navUrl.trim();
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      target = `https://${target}`;
    }

    setIsNavigating(true);
    try {
      const res = await fetch('/api/browser/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: currentSession.id,
          action: 'navigate',
          params: { url: target },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Navigation request failed.');
      onRefresh();
    } catch (err: any) {
      alert(`Navigation failed: ${err.message}`);
    } finally {
      setIsNavigating(false);
    }
  };

  const handleResumeHandoff = async () => {
    if (!currentSession) return;
    try {
      const res = await fetch('/api/browser/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSession.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Resume request failed.');
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to resume automation');
    }
  };

  const handleGeneratePairingCode = async () => {
    if (!currentSession) return;
    setPairingLoading(true);
    try {
      const res = await fetch(`/api/browser/sessions/${currentSession.id}/pairing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Could not generate pairing code.');
      setPairingCode(data.pairingCode);
      setPairingExpiresAt(data.expiresAt);
    } catch (err: any) {
      alert(err.message || 'Could not generate pairing code.');
    } finally {
      setPairingLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Isolated Browser Automation & Live Stream</h2>
          <p className="text-xs text-slate-400 mt-1">
            Persistent profiles connected via secure outbound WebSocket to your desktop companion agent.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={onRefresh}
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            title="Refresh browser status"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-sm transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Browser Session</span>
          </button>
        </div>
      </div>

      {/* Human Handoff Banner (Requirement 31 & 245) */}
      {currentSession && currentSession.waitingHuman && (
        <div className="p-4 rounded-xl bg-amber-950/60 border border-amber-600/70 text-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-amber-100">HUMAN ACTION REQUIRED (Automation Paused)</h4>
              <p className="text-xs text-amber-300/90 mt-0.5">
                Reason: {currentSession.handoffReason || 'CAPTCHA or 2FA verification required'}. The browser is now available for manual completion.
              </p>
            </div>
          </div>
          <button
            onClick={handleResumeHandoff}
            className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shrink-0 transition-colors cursor-pointer shadow-sm"
          >
            Resume AI Automation
          </button>
        </div>
      )}

      {/* Main Browser View & Profile Split */}
      {sessions.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-500 text-xs">
          <Globe className="w-8 h-8 mx-auto text-slate-600 mb-3" />
          <p className="text-sm font-medium text-slate-300">No browser sessions created yet</p>
          <p className="mt-1 max-w-sm mx-auto">
            Create an isolated browser profile (e.g. Chrome Session 01 - Google Work) to automate web actions safely.
          </p>
          <button
            onClick={() => setShowNewModal(true)}
            className="mt-4 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
          >
            Create First Session
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left Session Selector */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Isolated Profiles ({sessions.length})
            </h3>
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedSessionId(s.id)}
                className={`w-full text-left p-3 rounded-lg border text-xs transition-colors cursor-pointer ${
                  selectedSessionId === s.id
                    ? 'bg-indigo-600/15 border-indigo-500 text-indigo-300'
                    : 'bg-slate-950 border-slate-800/80 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="font-semibold text-slate-200">{s.sessionName}</div>
                <div className="flex items-center justify-between text-[11px] mt-1 text-slate-400">
                  <span>Profile: {s.profileName}</span>
                  <span
                    className={`capitalize font-medium ${
                      s.status === 'connected' ? 'text-emerald-400' : 'text-slate-500'
                    }`}
                  >
                    {s.status}
                  </span>
                </div>
              </button>
            ))}

            {/* Desktop Agent Pairing Instructions */}
            <div className="mt-4 pt-4 border-t border-slate-800 text-[11px] text-slate-400 space-y-2">
              <div className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Laptop className="w-3.5 h-3.5 text-indigo-400" />
                <span>Companion Desktop Agent:</span>
              </div>
              <p className="text-[10px] text-slate-500">
                Pair this exact session with the local <code className="text-indigo-300 font-mono">/browser-agent</code>. Use the one-time 30-minute code below in <code className="text-slate-300">BROWSER_PAIRING_CODE</code>.
              </p>
              <button
                onClick={handleGeneratePairingCode}
                disabled={!currentSession || pairingLoading}
                className="w-full px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium disabled:opacity-50 cursor-pointer"
              >
                {pairingLoading ? 'Generating…' : 'Generate Pairing Code'}
              </button>
              {pairingCode && (
                <div className="p-2.5 rounded-lg border border-indigo-500/30 bg-indigo-500/5">
                  <div className="text-[10px] text-slate-500">Pairing code (shown once)</div>
                  <code className="block mt-1 text-base tracking-widest text-indigo-300 font-mono select-all">{pairingCode}</code>
                  {pairingExpiresAt && <div className="mt-1 text-[10px] text-slate-500">Expires {new Date(pairingExpiresAt).toLocaleTimeString()}</div>}
                </div>
              )}
            </div>
          </div>

          {/* Right Live Browser View (3 Cols) */}
          <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            {/* Top Navigation URL Bar */}
            <form onSubmit={handleNavigate} className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={navUrl}
                  onChange={(e) => setNavUrl(e.target.value)}
                  placeholder={currentSession?.currentUrl || 'https://google.com'}
                  className="w-full pl-8 pr-4 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                />
                <Globe className="w-4 h-4 text-slate-500 absolute left-2.5 top-2.5" />
              </div>
              <button
                type="submit"
                disabled={isNavigating}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer shadow-xs disabled:opacity-50"
              >
                {isNavigating ? 'Loading...' : 'Navigate'}
              </button>

            </form>

            {/* Current Tab Metadata */}
            <div className="flex items-center justify-between text-xs text-slate-400 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-200">
                  {currentSession?.currentTitle || 'New Tab'}
                </span>
                <span className="text-slate-600">•</span>
                <span className="font-mono text-slate-400 text-[11px]">
                  {currentSession?.currentUrl || 'about:blank'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-emerald-400 text-[11px]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Isolated Profile</span>
              </div>
            </div>

            {/* Browser Policy Enforcement Banner (Requirement 60, 87) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div className="p-2 rounded bg-slate-950 border border-slate-800/80 flex items-center justify-between">
                <span className="text-slate-400">File Downloads:</span>
                <span className="font-semibold text-rose-400 font-mono">BLOCKED</span>
              </div>
              <div className="p-2 rounded bg-slate-950 border border-slate-800/80 flex items-center justify-between">
                <span className="text-slate-400">File Uploads:</span>
                <span className="font-semibold text-rose-400 font-mono">BLOCKED</span>
              </div>
              <div className="p-2 rounded bg-slate-950 border border-slate-800/80 flex items-center justify-between">
                <span className="text-slate-400">Cookie Theft:</span>
                <span className="font-semibold text-rose-400 font-mono">BLOCKED</span>
              </div>
              <div className="p-2 rounded bg-slate-950 border border-slate-800/80 flex items-center justify-between">
                <span className="text-slate-400">Password Extraction:</span>
                <span className="font-semibold text-rose-400 font-mono">BLOCKED</span>
              </div>
            </div>

            {/* Live Browser Viewport */}
            <div className="border border-slate-800 rounded-xl bg-slate-950 min-h-80 overflow-hidden flex items-center justify-center text-center text-xs text-slate-500">
              {currentSession?.screenshotBase64 ? (
                <img src={`data:image/jpeg;base64,${currentSession.screenshotBase64}`} alt="Live browser viewport" className="w-full h-auto max-h-[70vh] object-contain" />
              ) : (
                <div className="p-6">
                  <Camera className="w-10 h-10 text-slate-700 mx-auto mb-2" />
                  <div className="font-semibold text-slate-300">Live Browser Viewport</div>
                  <p className="max-w-md mt-1 text-slate-500">
                    {currentSession?.status === 'connected'
                      ? 'Waiting for the companion to publish the first screenshot.'
                      : 'Desktop Companion Agent is disconnected. Start /browser-agent locally to view the live viewport.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New Browser Session Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 shadow-xl space-y-4 text-xs">
            <h3 className="text-sm font-semibold text-slate-100">Create Isolated Browser Session</h3>
            <form onSubmit={handleCreateSession} className="space-y-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Session Name</label>
                <input
                  type="text"
                  required
                  value={newSessionName}
                  onChange={(e) => setNewSessionName(e.target.value)}
                  placeholder="e.g. Chrome Work, Cloudflare Management"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Account Mapping <span className="text-slate-500 font-normal">(optional)</span></label>
                <select
                  value={newProviderAccountId}
                  onChange={(e) => setNewProviderAccountId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                >
                  <option value="">No linked provider account</option>
                  {providerAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.provider.toUpperCase()} · {account.accountName}{account.username ? ` (@${account.username})` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-500 mt-1">Links this browser profile to one verified provider account for safer account selection.</p>
              </div>
              <p className="text-[11px] text-slate-500">
                Each session stores isolated cookies and local cache strictly on the companion machine.
              </p>
              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300"
                >
                  Cancel
                </button>
                <button type="submit" className="px-3.5 py-1.5 rounded-lg bg-indigo-600 text-white font-medium">
                  Create Session
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
