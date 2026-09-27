import React from 'react';
import {
  LayoutDashboard,
  MessageSquareCode,
  Users,
  FolderGit2,
  Rocket,
  Globe,
  KeyRound,
  ScrollText,
  ListTodo,
  Server,
  Settings,
  ShieldCheck,
} from 'lucide-react';

export type NavTab =
  | 'dashboard'
  | 'chat'
  | 'accounts'
  | 'projects'
  | 'deployments'
  | 'browser'
  | 'gateway'
  | 'logs'
  | 'tasks'
  | 'services'
  | 'settings';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  connectedAccountsCount: number;
  activeTasksCount: number;
  vaultReady: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  connectedAccountsCount,
  activeTasksCount,
  vaultReady,
}) => {
  const navItems = [
    { id: 'dashboard' as NavTab, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'chat' as NavTab, label: 'AI Chat', icon: MessageSquareCode, badge: 'Agent' },
    { id: 'accounts' as NavTab, label: 'Accounts', icon: Users, count: connectedAccountsCount },
    { id: 'projects' as NavTab, label: 'Projects', icon: FolderGit2 },
    { id: 'deployments' as NavTab, label: 'Deployments', icon: Rocket },
    { id: 'browser' as NavTab, label: 'Browser', icon: Globe },
    { id: 'gateway' as NavTab, label: 'APIs & Gateway', icon: KeyRound },
    { id: 'logs' as NavTab, label: 'Activity Logs', icon: ScrollText },
    { id: 'tasks' as NavTab, label: 'Tasks', icon: ListTodo, count: activeTasksCount },
    { id: 'services' as NavTab, label: 'Services', icon: Server },
    { id: 'settings' as NavTab, label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col h-screen shrink-0 text-slate-300 select-none">
      {/* Brand Header */}
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-sm shadow-indigo-500/20">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-semibold text-slate-100 text-sm tracking-tight leading-none">AI CONTROL CENTER</h1>
            <p className="text-[11px] text-slate-400 mt-1 leading-tight">Dev & Deployment Agent</p>
          </div>
        </div>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-600/15 text-indigo-400 font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {item.badge && (
                  <span className="px-1.5 py-0.5 text-[10px] uppercase font-semibold tracking-wider rounded bg-indigo-500/20 text-indigo-300">
                    {item.badge}
                  </span>
                )}
                {typeof item.count === 'number' && item.count > 0 && (
                  <span className="px-1.5 py-0.2 text-[10px] font-mono rounded bg-slate-800 text-slate-300">
                    {item.count}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </nav>

      {/* Footer Info */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/40 text-[11px] text-slate-500 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${vaultReady ? 'bg-emerald-500' : 'bg-amber-500'} animate-pulse`}></span>
          <span>{vaultReady ? 'AES-256 Vault Active' : 'Vault Setup Required'}</span>
        </div>
        <span className="font-mono text-[10px] text-slate-400">v1.0</span>
      </div>
    </aside>
  );
};
