import React, { useEffect, useMemo, useState } from 'react';
import {
  FolderGit2,
  Upload,
  Plus,
  Rocket,
  Trash2,
  ExternalLink,
  Code2,
  Play,
  Layers,
} from 'lucide-react';
import type { Project, ProviderConnection } from '../../shared/types.js';

interface ProjectsViewProps {
  projects: Project[];
  accounts: ProviderConnection[];
  onOpenUploadZip: () => void;
  onRefreshProjects: () => void;
  onTriggerDeploy: (projectId: string) => void;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  projects,
  accounts,
  onOpenUploadZip,
  onRefreshProjects,
  onTriggerDeploy,
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [repoOwner, setRepoOwner] = useState('');
  const [repoName, setRepoName] = useState('');
  const [buildCommand, setBuildCommand] = useState('npm install && npm run build');
  const [startCommand, setStartCommand] = useState('npm start');

  const githubAccounts = accounts.filter((a) => a.provider === 'github');
  const renderAccounts = accounts.filter((a) => a.provider === 'render');

  const [selectedGithubId, setSelectedGithubId] = useState(githubAccounts[0]?.id || '');
  const [selectedRenderId, setSelectedRenderId] = useState(renderAccounts[0]?.id || '');
  const selectedRenderConnection = renderAccounts.find((a) => a.id === selectedRenderId);
  const renderWorkspaces = useMemo(() => Array.isArray(selectedRenderConnection?.metadata?.workspaces) ? selectedRenderConnection.metadata.workspaces : [], [selectedRenderConnection]);
  const [selectedRenderWorkspaceOwnerId, setSelectedRenderWorkspaceOwnerId] = useState('');

  useEffect(() => {
    if (!selectedGithubId && githubAccounts[0]) setSelectedGithubId(githubAccounts[0].id);
    if (!selectedRenderId && renderAccounts[0]) setSelectedRenderId(renderAccounts[0].id);
  }, [githubAccounts, renderAccounts, selectedGithubId, selectedRenderId]);

  useEffect(() => {
    if (selectedRenderWorkspaceOwnerId && renderWorkspaces.some((w: any) => String(w.id) === selectedRenderWorkspaceOwnerId)) return;
    setSelectedRenderWorkspaceOwnerId(renderWorkspaces.length === 1 ? String(renderWorkspaces[0].id) : '');
  }, [selectedRenderId, renderWorkspaces, selectedRenderWorkspaceOwnerId]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: desc.trim() || undefined,
          githubAccountId: selectedGithubId || undefined,
          repoOwner: repoOwner.trim() || undefined,
          repoName: repoName.trim() || undefined,
          renderWorkspaceId: selectedRenderId || undefined,
          renderWorkspaceOwnerId: selectedRenderWorkspaceOwnerId || undefined,
          renderWorkspaceName: renderWorkspaces.find((w: any) => String(w.id) === selectedRenderWorkspaceOwnerId)?.name || undefined,
          buildCommand,
          startCommand,
        }),
      });

      if (res.ok) {
        setShowCreateModal(false);
        setName('');
        setDesc('');
        setRepoOwner('');
        setRepoName('');
        onRefreshProjects();
      }
    } catch {
      alert('Failed to save project');
    }
  };

  const handleDelete = async (id: string, projName: string) => {
    if (!confirm(`Delete project "${projName}"?`)) return;
    try {
      await fetch(`/api/projects/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) });
      onRefreshProjects();
    } catch {
      alert('Failed to delete project');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Project Memory & Deployments</h2>
          <p className="text-xs text-slate-400 mt-1">
            Store relationships between GitHub repositories, Render web services, and deployment configurations.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={onOpenUploadZip}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-200 text-xs font-medium cursor-pointer transition-colors"
          >
            <Upload className="w-3.5 h-3.5 text-indigo-400" />
            <span>Upload ZIP</span>
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Project</span>
          </button>
        </div>
      </div>

      {/* Projects List */}
      {projects.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-500 text-xs">
          <FolderGit2 className="w-8 h-8 mx-auto text-slate-600 mb-3" />
          <p className="text-sm font-medium text-slate-300">No projects registered yet</p>
          <p className="mt-1 max-w-sm mx-auto">
            Upload a ZIP archive to automatically inspect its framework and build scripts, or create a project manually.
          </p>
          <div className="flex items-center justify-center gap-2.5 mt-4">
            <button
              onClick={onOpenUploadZip}
              className="px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium cursor-pointer"
            >
              Upload Project ZIP
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => {
            const ghConn = accounts.find((a) => a.id === p.githubAccountId);
            const rndConn = accounts.find((a) => a.id === p.renderWorkspaceId);
            const rndWorkspace = rndConn?.metadata?.workspaces?.find((w: any) => String(w.id) === String(p.renderWorkspaceOwnerId));

            return (
              <div
                key={p.id}
                className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-4 shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-100">{p.name}</h4>
                      {p.description && <p className="text-xs text-slate-400 mt-0.5">{p.description}</p>}
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                        p.status === 'deploying'
                          ? 'bg-amber-500/10 text-amber-400'
                          : p.status === 'active'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {p.status}
                    </span>
                  </div>

                  {/* Relationship Link Card */}
                  <div className="mt-4 p-3 rounded-lg bg-slate-950/70 border border-slate-800/80 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">GitHub:</span>
                      <span className="text-slate-300 font-mono text-[11px]">
                        {ghConn ? `@${ghConn.username}` : 'Not linked'} / {p.repoName || 'repo'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Branch:</span>
                      <span className="text-slate-300 font-mono text-[11px]">{p.branch}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Render:</span>
                      <span className="text-slate-300 font-mono text-[11px]">
                        {rndWorkspace?.name || (rndConn ? `${rndConn.accountName} · workspace not selected` : 'Not linked')}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
                      <div>Build: <span className="font-mono text-slate-300">{p.buildCommand}</span></div>
                      <div>Start: <span className="font-mono text-slate-300">{p.startCommand}</span></div>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
                  <button
                    onClick={() => onTriggerDeploy(p.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer transition-colors shadow-xs"
                  >
                    <Rocket className="w-3.5 h-3.5" />
                    <span>Deploy</span>
                  </button>

                  <button
                    onClick={() => handleDelete(p.id, p.name)}
                    className="p-1.5 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Manual Project Creation Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-5 shadow-xl space-y-4 text-xs">
            <h3 className="text-sm font-semibold text-slate-100">Register New Project</h3>
            <form onSubmit={handleCreateProject} className="space-y-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Project Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Website Alpha"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">Description</label>
                <input
                  type="text"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="e.g. Production frontend web app"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">GitHub Account</label>
                  <select
                    value={selectedGithubId}
                    onChange={(e) => setSelectedGithubId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                  >
                    <option value="">Select account...</option>
                    {githubAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountName} (@{a.username})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Render API Connection</label>
                  <select
                    value={selectedRenderId}
                    onChange={(e) => { setSelectedRenderId(e.target.value); setSelectedRenderWorkspaceOwnerId(''); }}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                  >
                    <option value="">Select API connection...</option>
                    {renderAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label || a.accountName}
                      </option>
                    ))}
                  </select>
                  <label className="block text-slate-500 font-medium mb-1 mt-2">Workspace</label>
                  <select
                    value={selectedRenderWorkspaceOwnerId}
                    onChange={(e) => setSelectedRenderWorkspaceOwnerId(e.target.value)}
                    disabled={!selectedRenderId || renderWorkspaces.length === 0}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 disabled:opacity-50"
                  >
                    <option value="">{renderWorkspaces.length ? 'Select workspace...' : 'No workspace data'}</option>
                    {renderWorkspaces.map((w: any) => (
                      <option key={String(w.id)} value={String(w.id)}>{w.name || w.email || w.id}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Repository Owner</label>
                  <input
                    type="text"
                    value={repoOwner}
                    onChange={(e) => setRepoOwner(e.target.value)}
                    placeholder="e.g. user or org"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Repository Name</label>
                  <input
                    type="text"
                    value={repoName}
                    onChange={(e) => setRepoName(e.target.value)}
                    placeholder="e.g. alpha-repo"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">Build Command</label>
                <input
                  type="text"
                  value={buildCommand}
                  onChange={(e) => setBuildCommand(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">Start Command</label>
                <input
                  type="text"
                  value={startCommand}
                  onChange={(e) => setStartCommand(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 font-mono"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 rounded-lg bg-indigo-600 text-white font-medium shadow-xs"
                >
                  Save Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
