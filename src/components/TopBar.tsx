import React from 'react';
import { Sparkles, Shield, Stethoscope, Search, LogOut } from 'lucide-react';

interface TopBarProps {
  currentTabName: string;
  onOpenSelfTest: () => void;
  onSearchClick: () => void;
  agentReady: boolean;
  vaultReady: boolean;
  onLogout: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  currentTabName,
  onOpenSelfTest,
  onSearchClick,
  agentReady,
  vaultReady,
  onLogout,
}) => {
  return (
    <header className="h-13 bg-slate-900 border-b border-slate-800 px-6 flex items-center justify-between text-slate-300 shrink-0">
      {/* Page Title & Breadcrumb */}
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-slate-100 capitalize">{currentTabName}</h2>
        <span className="text-slate-600 text-xs">/</span>
        <span className="text-xs text-slate-400">Personal Workspace</span>
      </div>

      {/* Center Search / Command Trigger */}
      <button
        onClick={onSearchClick}
        className="hidden md:flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800 text-xs text-slate-400 hover:border-slate-700 transition-colors w-72"
      >
        <Search className="w-3.5 h-3.5 text-slate-500" />
        <span className="flex-1 text-left">Search accounts, repos, logs...</span>
        <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400 border border-slate-700/50">
          ⌘K
        </kbd>
      </button>

      {/* Right Status & Diagnostic Actions */}
      <div className="flex items-center gap-3">
        {/* AI Agent Status Pill */}
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-full text-xs bg-slate-800/80 border border-slate-700/60">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-[11px] font-medium text-slate-300">Own AI Brain</span>
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              agentReady ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
            }`}
          />
        </div>

        {/* Security Vault Indicator */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-slate-950/60 border border-slate-800 text-slate-400">
          <Shield className={`w-3.5 h-3.5 ${vaultReady ? 'text-emerald-400' : 'text-amber-400'}`} />
          <span className="text-[11px]">{vaultReady ? 'Vault Encrypted' : 'Vault Not Configured'}</span>
        </div>

        {/* System Self-Test Button */}
        <button
          onClick={onOpenSelfTest}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 transition-colors cursor-pointer"
        >
          <Stethoscope className="w-3.5 h-3.5" />
          <span>Self-Test</span>
        </button>
        <button
          onClick={onLogout}
          title="Sign out"
          className="p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
