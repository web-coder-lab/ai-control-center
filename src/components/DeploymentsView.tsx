import React, { useState } from 'react';
import { Rocket, CheckCircle2, AlertCircle, ExternalLink, Terminal, RotateCcw, Clock, ShieldAlert } from 'lucide-react';
import type { Deployment } from '../../shared/types.js';

interface DeploymentsViewProps { deployments: Deployment[]; onRefresh: () => void; }

export const DeploymentsView: React.FC<DeploymentsViewProps> = ({ deployments, onRefresh }) => {
  const [selectedDeployment, setSelectedDeployment] = useState<Deployment | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [actionMessage, setActionMessage] = useState('');

  const rollback = async () => {
    if (!selectedDeployment?.serviceId) { setActionMessage('This deployment is missing its Render service mapping.'); return; }
    if (!window.confirm(`Rollback ${selectedDeployment.projectName} to the previous Render deployment?`)) return;
    setRollingBack(true); setActionMessage('');
    try {
      const res = await fetch(`/api/deployments/${selectedDeployment.id}/rollback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Rollback failed');
      setActionMessage(`Rollback started${data.result?.targetDeployId ? ` to ${data.result.targetDeployId}` : ''}.`);
      onRefresh();
    } catch (err: any) { setActionMessage(err.message || 'Rollback failed'); }
    finally { setRollingBack(false); }
  };

  return <div className="p-6 max-w-7xl mx-auto space-y-6">
    <div className="flex items-center justify-between gap-4">
      <div><h2 className="text-lg font-semibold text-slate-100">Deployments</h2><p className="text-xs text-slate-400 mt-1">Live provider state only. No simulated deployment records.</p></div>
    </div>
    {deployments.length === 0 ? <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-500 text-xs"><Rocket className="w-8 h-8 mx-auto text-slate-600 mb-3"/><p className="text-sm font-medium text-slate-300">No deployments recorded</p><p className="mt-1">Start a real deployment to see provider status and logs here.</p></div> :
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-950/70 border-b border-slate-800 text-[11px] uppercase font-semibold text-slate-400"><tr><th className="py-3 px-4">Project</th><th className="py-3 px-4">Provider</th><th className="py-3 px-4">Status</th><th className="py-3 px-4">Commit</th><th className="py-3 px-4">Deployment</th><th className="py-3 px-4">Created</th><th className="py-3 px-4 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-800/80 text-slate-300">{deployments.map((d)=><tr key={d.id} className="hover:bg-slate-800/40"><td className="py-3 px-4 font-semibold text-slate-100">{d.projectName}</td><td className="py-3 px-4 uppercase font-mono text-[10px]">{d.provider}</td><td className="py-3 px-4"><span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] ${d.status==='live'?'bg-emerald-500/10 text-emerald-400':d.status==='failed'?'bg-rose-500/10 text-rose-400':'bg-amber-500/10 text-amber-400'}`}>{d.status==='live'?<CheckCircle2 className="w-3 h-3"/>:d.status==='failed'?<AlertCircle className="w-3 h-3"/>:<Clock className="w-3 h-3"/>}{d.status}</span></td><td className="py-3 px-4 font-mono text-[11px]">{d.commitHash?.slice(0,7)||'—'}</td><td className="py-3 px-4 font-mono text-[10px]">{d.deploymentId}</td><td className="py-3 px-4 text-slate-400">{new Date(d.createdAt).toLocaleString()}</td><td className="py-3 px-4 text-right"><button onClick={()=>setSelectedDeployment(d)} className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300">Details</button>{d.url&&<a href={d.url} target="_blank" rel="noreferrer" className="inline-flex ml-2 px-2.5 py-1 text-emerald-400">Open</a>}</td></tr>)}</tbody></table></div></div>}
    {selectedDeployment&&<div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"><div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl p-5 shadow-2xl space-y-4"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Terminal className="w-4 h-4 text-indigo-400"/><h3 className="text-sm font-semibold text-slate-100">{selectedDeployment.projectName}</h3></div><button onClick={()=>setSelectedDeployment(null)} className="px-2 py-1 rounded bg-slate-800 text-slate-300">Close</button></div>{selectedDeployment.errorDiagnosis&&<div className="p-3 rounded-xl bg-rose-950/30 border border-rose-800/50 text-xs text-rose-200"><div className="font-semibold flex items-center gap-2"><ShieldAlert className="w-4 h-4"/> {selectedDeployment.errorDiagnosis.category}</div><div className="mt-1">{selectedDeployment.errorDiagnosis.whatHappened}</div><div className="mt-1 text-rose-300">{selectedDeployment.errorDiagnosis.suggestedFix}</div></div>}{!selectedDeployment.errorDiagnosis&&selectedDeployment.status==='failed'&&<div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-400">No verified diagnosis has been stored yet. Use the deployment logs and run the diagnosis endpoint before changing source code.</div>}<div className="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 max-h-80 overflow-y-auto">{selectedDeployment.buildLogs?.length?selectedDeployment.buildLogs.map((l,i)=><div key={i}>{l}</div>):<div className="text-slate-600">No provider logs recorded yet.</div>}</div>{actionMessage&&<div className={`text-xs p-3 rounded-lg border ${actionMessage.toLowerCase().includes('failed')||actionMessage.toLowerCase().includes('missing')?'text-rose-300 border-rose-800/50 bg-rose-950/20':'text-emerald-300 border-emerald-800/50 bg-emerald-950/20'}`}>{actionMessage}</div>}<div className="flex items-center justify-between text-xs text-slate-400"><span>Deployment ID: {selectedDeployment.deploymentId}</span><button onClick={rollback} disabled={rollingBack||!selectedDeployment.serviceId} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-50"><RotateCcw className="w-3.5 h-3.5"/>{rollingBack?'Starting…':'Rollback previous'}</button></div></div></div>}
  </div>;
};
