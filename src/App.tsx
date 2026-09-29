import React, { useState, useEffect } from 'react';
import { Sidebar, type NavTab } from './components/Sidebar.js';
import { TopBar } from './components/TopBar.js';
import { DashboardView } from './components/DashboardView.js';
import { ChatView } from './components/ChatView.js';
import { AccountsView } from './components/AccountsView.js';
import { ProjectsView } from './components/ProjectsView.js';
import { DeploymentsView } from './components/DeploymentsView.js';
import { BrowserView } from './components/BrowserView.js';
import { GatewayView } from './components/GatewayView.js';
import { LogsView } from './components/LogsView.js';
import { TasksView } from './components/TasksView.js';
import { ServicesView } from './components/ServicesView.js';
import { SettingsView } from './components/SettingsView.js';
import { LoginScreen } from './components/LoginScreen.js';

// Modals
import { ConnectAccountModal } from './components/ConnectAccountModal.js';
import { UploadZipModal } from './components/UploadZipModal.js';
import { CreateGatewayKeyModal } from './components/CreateGatewayKeyModal.js';
import { SystemSelfTestModal } from './components/SystemSelfTestModal.js';

import type {
  ProviderConnection,
  Project,
  Deployment,
  Task,
  ActivityLog,
  GatewayKey,
  BrowserSession,
  TokenRequest,
  ProviderType,
} from '../shared/types.js';
import { Search, X } from 'lucide-react';

export default function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [accounts, setAccounts] = useState<ProviderConnection[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [keys, setKeys] = useState<GatewayKey[]>([]);
  const [browserSessions, setBrowserSessions] = useState<BrowserSession[]>([]);
  const [tokenRequests, setTokenRequests] = useState<TokenRequest[]>([]);
  const [chatPrompt, setChatPrompt] = useState<string>('');
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [vaultReady, setVaultReady] = useState(false);

  // Modals state
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [connectProvider, setConnectProvider] = useState<ProviderType>('github');
  const [isUploadZipModalOpen, setIsUploadZipModalOpen] = useState(false);
  const [isCreateKeyModalOpen, setIsCreateKeyModalOpen] = useState(false);
  const [isSelfTestModalOpen, setIsSelfTestModalOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [agentReady, setAgentReady] = useState(false);

  const loadData = async () => {
    try {
      const authRes = await fetch('/api/auth/status');
      const auth = await authRes.json();
      setAuthConfigured(Boolean(auth.configured));
      setAuthenticated(Boolean(auth.authenticated));
      setVaultReady(Boolean(auth.vaultConfigured));
      setAuthChecked(true);
      if (!auth.authenticated) return;

      const [accRes, projRes, depRes, taskRes, logRes, keyRes, sessRes, reqRes, diagRes] = await Promise.all([
        fetch('/api/accounts').then((r) => r.json()).catch(() => ({ accounts: [] })),
        fetch('/api/projects').then((r) => r.json()).catch(() => ({ projects: [] })),
        fetch('/api/deployments').then((r) => r.json()).catch(() => ({ deployments: [] })),
        fetch('/api/tasks').then((r) => r.json()).catch(() => ({ tasks: [] })),
        fetch('/api/logs').then((r) => r.json()).catch(() => ({ logs: [] })),
        fetch('/api/gateway/keys').then((r) => r.json()).catch(() => ({ keys: [] })),
        fetch('/api/browser/sessions').then((r) => r.json()).catch(() => ({ sessions: [] })),
        fetch('/api/gateway/requests').then((r) => r.json()).catch(() => ({ requests: [] })),
        fetch('/api/system/diagnostics').then((r) => r.json()).catch(() => ({ diagnostics: {} })),
      ]);

      if (accRes.accounts) setAccounts(accRes.accounts);
      if (projRes.projects) setProjects(projRes.projects);
      if (depRes.deployments) setDeployments(depRes.deployments);
      if (taskRes.tasks) setTasks(taskRes.tasks);
      if (logRes.logs) setLogs(logRes.logs);
      if (keyRes.keys) setKeys(keyRes.keys);
      if (sessRes.sessions) setBrowserSessions(sessRes.sessions);
      if (reqRes.requests) setTokenRequests(reqRes.requests);
      setAgentReady(diagRes?.diagnostics?.agent?.status === 'ready');
    } catch (err) {
      console.error('Error fetching initial data:', err);
    }
  };

  useEffect(() => {
    void loadData();
    const interval = setInterval(loadData, 10000);
    if (!authenticated) return () => clearInterval(interval);
    let socket: WebSocket | null = null;
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/ws/events`);
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type === 'browser.snapshot' && payload.data?.sessionId) {
            setBrowserSessions((current) => current.map((s) => s.id === payload.data.sessionId ? { ...s, ...(payload.data.url ? { currentUrl: payload.data.url } : {}), ...(payload.data.title ? { currentTitle: payload.data.title } : {}), ...(payload.data.screenshot ? { screenshotBase64: payload.data.screenshot } : {}) } : s));
            return;
          }
        } catch { /* fall through to a full refresh */ }
        void loadData();
      };
    } catch { /* periodic refresh remains available */ }
    return () => {
      clearInterval(interval);
      socket?.close();
    };
  }, [authenticated]);

  // Keyboard Shortcuts (Requirement 160)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setCurrentTab('chat');
      }
      if (e.key === 'Escape') {
        setIsSearchOpen(false);
        setIsConnectModalOpen(false);
        setIsUploadZipModalOpen(false);
        setIsCreateKeyModalOpen(false);
        setIsSelfTestModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleQuickChatPrompt = (prompt: string) => {
    setChatPrompt(prompt);
    setCurrentTab('chat');
  };

  const handleTriggerDeploy = (projectId: string) => {
    const proj = projects.find((p) => p.id === projectId);
    setChatPrompt(`Deploy project "${proj?.name || projectId}" to Render and verify deployment.`);
    setCurrentTab('chat');
  };

  // Search results
  const searchResults = searchQuery.trim()
    ? [
        ...accounts
          .filter((a) => a.accountName.toLowerCase().includes(searchQuery.toLowerCase()))
          .map((a) => ({ type: 'Account', title: a.accountName, tab: 'accounts' as NavTab })),
        ...projects
          .filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
          .map((p) => ({ type: 'Project', title: p.name, tab: 'projects' as NavTab })),
        ...deployments
          .filter((d) => d.projectName.toLowerCase().includes(searchQuery.toLowerCase()))
          .map((d) => ({ type: 'Deployment', title: `${d.projectName} (${d.status})`, tab: 'deployments' as NavTab })),
        ...keys
          .filter((k) => k.keyName.toLowerCase().includes(searchQuery.toLowerCase()))
          .map((k) => ({ type: 'Gateway Key', title: k.keyName, tab: 'gateway' as NavTab })),
        ...logs
          .filter((l) => [l.operation, l.target, l.actor, l.safeErrorMessage].filter(Boolean).some((v) => String(v).toLowerCase().includes(searchQuery.toLowerCase())))
          .slice(0, 20)
          .map((l) => ({ type: 'Activity', title: `${l.operation} · ${l.status}`, tab: 'logs' as NavTab })),
        ...tasks
          .filter((t) => t.request.toLowerCase().includes(searchQuery.toLowerCase()))
          .slice(0, 20)
          .map((t) => ({ type: 'Task', title: t.request, tab: 'tasks' as NavTab })),
        ...browserSessions
          .filter((s) => [s.sessionName, s.profileName, s.currentUrl].filter(Boolean).some((v) => String(v).toLowerCase().includes(searchQuery.toLowerCase())))
          .map((s) => ({ type: 'Browser', title: s.sessionName, tab: 'browser' as NavTab })),
      ]
    : [];

  if (!authChecked) {
    return <div className="min-h-screen bg-slate-950" />;
  }
  if (!authenticated) {
    return <LoginScreen configured={authConfigured} onAuthenticated={() => { setAuthenticated(true); void loadData(); }} />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans antialiased">
      {/* Primary Left Navigation */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        connectedAccountsCount={accounts.length}
        activeTasksCount={tasks.filter((t) => t.status === 'executing').length}
        vaultReady={vaultReady}
      />

      {/* Main Workspace Frame */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden min-w-0">
        <TopBar
          currentTabName={currentTab}
          onOpenSelfTest={() => setIsSelfTestModalOpen(true)}
          onSearchClick={() => setIsSearchOpen(true)}
          agentReady={agentReady}
          vaultReady={vaultReady}
          onLogout={async () => { await fetch('/api/auth/logout', { method: 'POST' }); setAuthenticated(false); }}
        />

        {/* View Router */}
        <main className="flex-1 overflow-y-auto bg-slate-950 relative">
          {currentTab === 'dashboard' && (
            <DashboardView
              accounts={accounts}
              deployments={deployments}
              tasks={tasks}
              logs={logs}
              keys={keys}
              onNavigate={setCurrentTab}
              onOpenUploadZip={() => setIsUploadZipModalOpen(true)}
              onQuickChatPrompt={handleQuickChatPrompt}
            />
          )}

          {currentTab === 'chat' && (
            <ChatView
              initialPrompt={chatPrompt}
              onClearInitialPrompt={() => setChatPrompt('')}
            />
          )}

          {currentTab === 'accounts' && (
            <AccountsView
              accounts={accounts}
              onOpenConnectModal={() => setIsConnectModalOpen(true)}
              onRefreshAccounts={loadData}
            />
          )}

          {currentTab === 'projects' && (
            <ProjectsView
              projects={projects}
              accounts={accounts}
              onOpenUploadZip={() => setIsUploadZipModalOpen(true)}
              onRefreshProjects={loadData}
              onTriggerDeploy={handleTriggerDeploy}
            />
          )}

          {currentTab === 'deployments' && (
            <DeploymentsView
              deployments={deployments}
              onRefresh={loadData}
            />
          )}

          {currentTab === 'browser' && (
            <BrowserView
              sessions={browserSessions}
              onRefresh={loadData}
            />
          )}

          {currentTab === 'gateway' && (
            <GatewayView
              keys={keys}
              tokenRequests={tokenRequests}
              onOpenCreateKeyModal={() => setIsCreateKeyModalOpen(true)}
              onRefresh={loadData}
            />
          )}

          {currentTab === 'logs' && (
            <LogsView
              logs={logs}
              onRefresh={loadData}
            />
          )}

          {currentTab === 'tasks' && (
            <TasksView
              tasks={tasks}
              onRefresh={loadData}
            />
          )}

          {currentTab === 'services' && (
            <ServicesView
              accounts={accounts}
              onOpenConnectModal={(provider) => { setConnectProvider(provider); setIsConnectModalOpen(true); }}
            />
          )}

          {currentTab === 'settings' && (
            <SettingsView
              accounts={accounts}
              keys={keys}
              onOpenSelfTest={() => setIsSelfTestModalOpen(true)}
              onRefresh={loadData}
            />
          )}
        </main>
      </div>

      {/* Global Universal Search Dialog (Requirement 38 & 160) */}
      {isSearchOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-start justify-center pt-20 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-4 shadow-2xl space-y-3 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-2.5 pb-2 border-b border-slate-800">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Universal Search across accounts, repos, services, keys..."
                className="w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
              <button
                onClick={() => setIsSearchOpen(false)}
                className="p-1 rounded text-slate-500 hover:text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-1 text-xs">
              {searchResults.length > 0 ? (
                searchResults.map((res, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setCurrentTab(res.tab);
                      setIsSearchOpen(false);
                      setSearchQuery('');
                    }}
                    className="w-full text-left p-2 rounded-lg hover:bg-slate-800 flex items-center justify-between text-slate-200"
                  >
                    <span>{res.title}</span>
                    <span className="text-[10px] text-slate-500 uppercase font-mono">{res.type}</span>
                  </button>
                ))
              ) : searchQuery ? (
                <div className="p-4 text-center text-slate-500 text-xs">No matching resources found.</div>
              ) : (
                <div className="p-4 text-center text-slate-500 text-xs">
                  Type to search accounts, projects, deployments, tasks, browser sessions, logs, or gateway keys...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <ConnectAccountModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        onSuccess={loadData}
        defaultProvider={connectProvider}
      />

      <UploadZipModal
        isOpen={isUploadZipModalOpen}
        onClose={() => setIsUploadZipModalOpen(false)}
        onProjectCreated={loadData}
      />

      <CreateGatewayKeyModal
        isOpen={isCreateKeyModalOpen}
        onClose={() => setIsCreateKeyModalOpen(false)}
        onCreated={loadData}
      />

      <SystemSelfTestModal
        isOpen={isSelfTestModalOpen}
        onClose={() => setIsSelfTestModalOpen(false)}
      />
    </div>
  );
}
