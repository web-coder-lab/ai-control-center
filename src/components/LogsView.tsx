import React, { useState } from 'react';
import {
  ScrollText,
  Search,
  Download,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  Clock,
  ExternalLink,
} from 'lucide-react';
import type { ActivityLog } from '../../shared/types.js';

interface LogsViewProps {
  logs: ActivityLog[];
  onRefresh: () => void;
}

export const LogsView: React.FC<LogsViewProps> = ({ logs, onRefresh }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);

  const filteredLogs = logs.filter((l) => {
    if (providerFilter !== 'all' && l.provider !== providerFilter) return false;
    if (statusFilter !== 'all' && l.status !== statusFilter) return false;
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      return (
        l.operation.toLowerCase().includes(term) ||
        (l.target && l.target.toLowerCase().includes(term)) ||
        l.actor.toLowerCase().includes(term) ||
        (l.safeErrorMessage && l.safeErrorMessage.toLowerCase().includes(term))
      );
    }
    return true;
  });

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(filteredLogs, null, 2));
    const dl = document.createElement('a');
    dl.setAttribute('href', dataStr);
    dl.setAttribute('download', `activity_logs_${Date.now()}.json`);
    dl.click();
  };

  const handleExportCsv = () => {
    window.open('/api/logs?format=csv', '_blank');
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Audit Trail & Activity Logs</h2>
          <p className="text-xs text-slate-400 mt-1">
            Real-time record of all agent operations, external gateway calls, and security events. Secrets are automatically redacted.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={handleExportJson}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export JSON</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by operation, target, actor, or message..."
            className="w-full pl-8 pr-4 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          />
          <Search className="w-4 h-4 text-slate-500 absolute left-2.5 top-2.5" />
        </div>

        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300 capitalize"
        >
          <option value="all">All Providers</option>
          <option value="github">GitHub</option>
          <option value="render">Render</option>
          <option value="browser">Browser</option>
                  </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300 capitalize"
        >
          <option value="all">All Statuses</option>
          <option value="success">Success</option>
          <option value="blocked">Blocked</option>
          <option value="failed">Failed</option>
          <option value="waiting_human">Waiting Human</option>
        </select>
      </div>

      {/* Logs Table */}
      {filteredLogs.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-500 text-xs">
          <ScrollText className="w-8 h-8 mx-auto text-slate-600 mb-3" />
          <p className="text-sm font-medium text-slate-300">No matching activity logs</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/70 border-b border-slate-800 text-[11px] uppercase font-semibold text-slate-400">
                <tr>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Provider</th>
                  <th className="py-3 px-4">Operation</th>
                  <th className="py-3 px-4">Target</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-slate-300">
                {filteredLogs.map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className="hover:bg-slate-800/40 transition-colors cursor-pointer"
                  >
                    <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-200">{log.actor}</td>
                    <td className="py-3 px-4 uppercase font-mono text-[10px] text-slate-400">
                      {log.provider || 'system'}
                    </td>
                    <td className="py-3 px-4 font-mono text-indigo-400">{log.operation}</td>
                    <td className="py-3 px-4 text-slate-400 max-w-xs truncate">{log.target || '—'}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium capitalize ${
                          log.status === 'success'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : log.status === 'blocked'
                            ? 'bg-amber-500/10 text-amber-400'
                            : 'bg-rose-500/10 text-rose-400'
                        }`}
                      >
                        {log.status === 'success' ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : log.status === 'blocked' ? (
                          <ShieldAlert className="w-3 h-3" />
                        ) : (
                          <AlertCircle className="w-3 h-3" />
                        )}
                        {log.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500 text-[10px]">{log.durationMs}ms</td>
                    <td className="py-3 px-4 text-right text-indigo-400 text-xs">Inspect &rarr;</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail Inspection Modal (Requirement 227) */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-5 shadow-xl space-y-4 text-xs animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-slate-100">Event Detail Inspector</h3>
              <button
                onClick={() => setSelectedLog(null)}
                className="px-2 py-1 rounded bg-slate-800 text-slate-400 hover:text-slate-200"
              >
                Close
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] space-y-2 text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-500">Operation ID:</span>
                <span className="text-indigo-400">{selectedLog.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Request ID:</span>
                <span>{selectedLog.requestId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Timestamp:</span>
                <span>{selectedLog.timestamp}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Actor:</span>
                <span className="text-slate-200">{selectedLog.actor}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Provider:</span>
                <span className="uppercase text-slate-300">{selectedLog.provider || 'system'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Operation:</span>
                <span className="text-emerald-400">{selectedLog.operation}</span>
              </div>
              {selectedLog.capability && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Capability:</span>
                  <span className="text-indigo-300">{selectedLog.capability}</span>
                </div>
              )}
              {selectedLog.safeErrorMessage && (
                <div className="pt-2 border-t border-slate-800 text-amber-400">
                  Message: {selectedLog.safeErrorMessage}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
