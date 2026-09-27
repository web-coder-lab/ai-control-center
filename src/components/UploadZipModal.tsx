import React, { useState } from 'react';
import { X, Upload, CheckCircle2, AlertTriangle, FileCode2, ShieldAlert } from 'lucide-react';
import type { ZipAnalysisResult } from '../../server/deployment/zip.analyzer.js';

interface UploadZipModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: () => void;
}

export const UploadZipModal: React.FC<UploadZipModalProps> = ({
  isOpen,
  onClose,
  onProjectCreated,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<ZipAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [buildCommand, setBuildCommand] = useState('');
  const [startCommand, setStartCommand] = useState('');
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    if (!selected.name.endsWith('.zip')) {
      setError('Please upload a standard .zip archive file.');
      return;
    }

    setFile(selected);
    setError(null);
    setIsAnalyzing(true);

    try {
      const buffer = await selected.arrayBuffer();
      const res = await fetch('/api/upload-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buffer,
      });

      const data = await res.json();
      if (data.success) {
        setAnalysis(data.analysis);
        setUploadId(data.uploadId);
        setProjectName(data.analysis.name || 'analyzed-project');
        setBuildCommand(data.analysis.detectedBuildCommand || '');
        setStartCommand(data.analysis.detectedStartCommand || '');
      } else {
        setError(data.message || 'ZIP analysis failed');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to upload and analyze ZIP archive');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCreateProject = async () => {
    if (!analysis || !uploadId || !projectName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: projectName.trim(),
          description: `Analyzed from ZIP (${analysis.framework})`,
          projectType: analysis.projectType,
          buildCommand: buildCommand.trim() || undefined,
          startCommand: startCommand.trim() || undefined,
          envVarNames: analysis.envVarNames,
          uploadId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to register project');
      onProjectCreated();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to register project');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-5 shadow-xl space-y-4 text-xs animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-slate-100">Safe ZIP Project Analyzer</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-300 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>{error}</div>
          </div>
        )}

        {!analysis ? (
          <div className="border-2 border-dashed border-slate-800 hover:border-slate-700 rounded-xl p-8 text-center transition-colors">
            <input
              type="file"
              accept=".zip"
              onChange={handleFileChange}
              className="hidden"
              id="zip-upload-input"
            />
            <label htmlFor="zip-upload-input" className="cursor-pointer block">
              <FileCode2 className="w-8 h-8 text-indigo-400 mx-auto mb-2" />
              <div className="font-semibold text-slate-200">Select or drop a ZIP archive</div>
              <div className="text-[11px] text-slate-500 mt-1">
                Protected against zip bombs, path traversal & oversized files (max 50MB upload / 100MB expanded analysis)
              </div>
              {isAnalyzing && (
                <div className="mt-4 text-xs text-indigo-400 font-medium animate-pulse">
                  Inspecting package.json, configs, and dependencies...
                </div>
              )}
            </label>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Detected Framework:</span>
                <span className="font-semibold text-emerald-400">{analysis.framework}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Total Archive Files:</span>
                <span className="font-mono text-slate-300">{analysis.totalFiles} files</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Build Command:</span>
                <span className="font-mono text-indigo-300">{analysis.detectedBuildCommand}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Start Command:</span>
                <span className="font-mono text-indigo-300">{analysis.detectedStartCommand || 'None (Static)'}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Project Name</label>
                <input value={projectName} onChange={(e) => setProjectName(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Build Command</label>
                  <input value={buildCommand} onChange={(e) => setBuildCommand(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 font-mono" />
                </div>
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Start Command</label>
                  <input value={startCommand} onChange={(e) => setStartCommand(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 font-mono" />
                </div>
              </div>
            </div>

            {analysis.envVarNames.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Referenced Environment Variables (Names only):
                </div>
                <div className="flex flex-wrap gap-1">
                  {analysis.envVarNames.map((env) => (
                    <span key={env} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">
                      {env}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-slate-800 flex justify-end gap-2.5">
              <button
                onClick={() => {
                  setAnalysis(null);
                  setFile(null);
                }}
                className="px-3.5 py-2 rounded-lg bg-slate-800 text-slate-300 font-medium"
              >
                Upload Different File
              </button>
              <button
                onClick={handleCreateProject}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
              >
                Save Project & Continue
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
