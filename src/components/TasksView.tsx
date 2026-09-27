import React from 'react';
import {
  ListTodo,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  Play,
  RotateCcw,
} from 'lucide-react';
import type { Task } from '../../shared/types.js';

interface TasksViewProps {
  tasks: Task[];
  onRefresh: () => void;
}

export const TasksView: React.FC<TasksViewProps> = ({ tasks, onRefresh }) => {
  const handleCancelTask = async (taskId: string) => {
    try {
      await fetch(`/api/tasks/${taskId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled by workspace owner' }),
      });
      onRefresh();
    } catch {
      alert('Failed to cancel task');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Task Engine & Queue</h2>
          <p className="text-xs text-slate-400 mt-1">
            Asynchronous task coordination with step-level verification, resource locks, and cancellation support.
          </p>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-500 text-xs">
          <ListTodo className="w-8 h-8 mx-auto text-slate-600 mb-3" />
          <p className="text-sm font-medium text-slate-300">No background tasks recorded</p>
          <p className="mt-1 max-w-sm mx-auto">
            Tasks dispatched through AI Chat or external Gateway API will show here with real verified step progress.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-sm"
            >
              {/* Task Header */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-100 text-sm">"{task.request}"</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        task.status === 'completed'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : task.status === 'executing'
                          ? 'bg-indigo-500/10 text-indigo-400'
                          : task.status === 'failed'
                          ? 'bg-rose-500/10 text-rose-400'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {task.status}
                    </span>
                  </div>
                  <div className="text-slate-400 text-xs mt-1">
                    Agent: <span className="text-slate-200">{task.agent}</span> • ID: <span className="font-mono text-slate-500">{task.id}</span>
                  </div>
                </div>

                {task.status === 'executing' && (
                  <button
                    onClick={() => handleCancelTask(task.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-950/40 text-rose-300 border border-rose-800/50 hover:bg-rose-900/40 text-xs font-medium cursor-pointer"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Cancel Task</span>
                  </button>
                )}
              </div>

              {/* Steps Progress */}
              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Verified Steps ({task.currentStep}/{task.totalSteps})
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {task.steps.map((step, idx) => (
                    <div
                      key={step.id}
                      className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        {step.status === 'completed' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        ) : step.status === 'running' ? (
                          <Clock className="w-3.5 h-3.5 text-indigo-400 shrink-0 animate-spin" />
                        ) : step.status === 'failed' ? (
                          <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                        )}
                        <span className="text-slate-200 truncate">{step.title}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">#{idx + 1}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
