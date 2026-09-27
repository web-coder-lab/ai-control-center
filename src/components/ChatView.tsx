import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Sparkles,
  Bot,
  User,
  CheckCircle2,
  Clock,
  AlertCircle,
  Terminal,
} from 'lucide-react';
import type { TaskStep, ActivityLog } from '../../shared/types.js';

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  executedTools?: Array<{ name: string; args: any; result: any }>;
  timestamp: string;
}

interface ChatViewProps {
  initialPrompt?: string;
  onClearInitialPrompt?: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({ initialPrompt, onClearInitialPrompt }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'msg_welcome',
      role: 'model',
      text: 'AI Control Center is ready. The control/tool layer is installed, but the user-owned AI brain is not installed yet. No external AI API is being used. Build your own local brain and connect it to this chat boundary to enable natural-language reasoning.',
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeTaskSteps, setActiveTaskSteps] = useState<TaskStep[]>([]);
  const [recentExecutionLogs, setRecentExecutionLogs] = useState<ActivityLog[]>([]);
  const [taskProof, setTaskProof] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialPrompt) {
      setInput(initialPrompt);
      if (onClearInitialPrompt) onClearInitialPrompt();
    }
  }, [initialPrompt]);

  useEffect(() => {
    let disposed = false;
    const loadLogs = async () => {
      try {
        const res = await fetch('/api/logs?limit=12');
        if (!res.ok) return;
        const data = await res.json();
        if (!disposed) setRecentExecutionLogs(data.logs || []);
      } catch {}
    };
    void loadLogs();
    const timer = window.setInterval(loadLogs, isLoading ? 1200 : 5000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [isLoading]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTaskSteps]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userText = input.trim();
    setInput('');

    const userMsg: Message = {
      id: `usr_${Date.now()}`,
      role: 'user',
      text: userText,
      timestamp: new Date().toLocaleTimeString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    // Do not fabricate progress. We show real activity logs while the native agent is running.
    setActiveTaskSteps([]);
    setTaskProof(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          history: messages.map((m) => ({ role: m.role, text: m.text })),
        }),
      });

      const data = await res.json();

      if (data.success) {
        // A plan is not proof of completion. Keep it as a neutral plan list; verified activity below is the source of truth.
        setActiveTaskSteps((data.plan || []).map((title: string, idx: number) => ({
          id: `plan_${idx}`, taskId: 'chat', title, status: 'pending', timestamp: new Date().toLocaleTimeString(),
        })));

        if (data.executedTools && data.executedTools.length > 0) {          const lastTool = data.executedTools[data.executedTools.length - 1];
          setTaskProof({
            operation: lastTool.name,
            args: lastTool.args,
            verified: true,
            timestamp: new Date().toISOString(),
          });
        }

        const modelMsg: Message = {
          id: `mod_${Date.now()}`,
          role: 'model',
          text: data.text,
          executedTools: data.executedTools,
          timestamp: new Date().toLocaleTimeString(),
        };
        setMessages((prev) => [...prev, modelMsg]);
      } else {
        setActiveTaskSteps((data.plan || []).map((title: string, idx: number) => ({ id: `plan_${idx}`, taskId: 'chat', title, status: idx === 0 ? 'failed' : 'pending', timestamp: idx === 0 ? new Date().toLocaleTimeString() : '' })));
        const errMsg: Message = {
          id: `mod_err_${Date.now()}`,
          role: 'model',
          text: `Action could not be executed: ${data.message || 'Unknown error'}`,
          timestamp: new Date().toLocaleTimeString(),
        };
        setMessages((prev) => [...prev, errMsg]);
      }
    } catch (err: any) {
      setActiveTaskSteps([]);
      const errMsg: Message = {
        id: `mod_err_${Date.now()}`,
        role: 'model',
        text: `Connection failed: ${err.message}`,
        timestamp: new Date().toLocaleTimeString(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-full overflow-hidden bg-slate-950">
      {/* Central Chat Panel */}
      <div className="flex-1 flex flex-col h-full border-r border-slate-800">
        {/* Chat History */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 text-xs leading-relaxed max-w-3xl ${
                msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''
              }`}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800 text-indigo-400 border border-slate-700'
                }`}
              >
                {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              <div
                className={`rounded-xl p-4 ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-tr-none'
                    : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none shadow-sm'
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.text}</div>

                {/* Render Executed Tool Badges & Data if available */}
                {msg.executedTools && msg.executedTools.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-2">
                    <div className="text-[10px] uppercase font-semibold text-slate-400 flex items-center gap-1.5">
                      <Terminal className="w-3 h-3 text-emerald-400" />
                      <span>Verified Tool Execution:</span>
                    </div>
                    {msg.executedTools.map((t, idx) => (
                      <div
                        key={idx}
                        className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800 font-mono text-[11px] text-slate-300"
                      >
                        <div className="flex items-center justify-between text-emerald-400">
                          <span className="font-semibold">{t.name}</span>
                          <span className="text-[10px] text-slate-500">verified</span>
                        </div>
                        {t.result?.message && (
                          <div className="text-slate-400 mt-1">{t.result.message}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div
                  className={`mt-2 text-[10px] ${
                    msg.role === 'user' ? 'text-indigo-200' : 'text-slate-500'
                  }`}
                >
                  {msg.timestamp}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/60">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2 max-w-4xl mx-auto"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything or command in natural language / Hinglish (e.g. 'Show all GitHub repos', 'Is ZIP ko Render par deploy karo')..."
              className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer"
            >
              <span>Send</span>
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>

          {/* Quick Suggestions below Chat (Requirement 159) */}
          <div className="flex flex-wrap gap-2 mt-2.5 max-w-4xl mx-auto text-[11px] text-slate-400">
            <span className="text-slate-500">Suggestions:</span>
            {[
              'Check GitHub accounts',
              'Check Render services',
              'System audit karo',
            ].map((s) => (
              <button
                key={s}
                onClick={() => setInput(s)}
                className="hover:text-indigo-400 transition-colors cursor-pointer"
              >
                "{s}"
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Live Task Execution UI & Proof Panel (Requirement 6 & 108) */}
      <div className="w-80 bg-slate-900/90 flex flex-col p-4 shrink-0 overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <h3 className="text-xs font-semibold text-slate-100">Task Timeline</h3>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-500/10 text-indigo-400 font-medium">
            Live
          </span>
        </div>

        {/* Real activity timeline */}
        <div className="mt-4 space-y-3 flex-1">
          {isLoading ? (
            <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs text-indigo-200">
              <div className="flex items-center gap-2 font-medium"><div className="w-3.5 h-3.5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" /> Native agent is executing…</div>
              <p className="mt-1 text-[11px] text-slate-500">Only verified backend events are shown below.</p>
            </div>
          ) : null}

          {activeTaskSteps.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Plan</div>
              <div className="space-y-2">
                {activeTaskSteps.map((step) => (
                  <div key={step.id} className="flex items-start gap-2 text-xs">
                    {step.status === 'completed' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" /> : step.status === 'failed' ? <AlertCircle className="w-3.5 h-3.5 text-rose-400 mt-0.5 shrink-0" /> : <div className="w-3.5 h-3.5 rounded-full border border-slate-600 mt-0.5 shrink-0" />}
                    <span className={step.status === 'completed' ? 'text-slate-300' : step.status === 'failed' ? 'text-rose-300' : 'text-slate-500'}>{step.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Recent verified activity</div>
            {recentExecutionLogs.length === 0 ? (
              <div className="py-8 text-center text-slate-600 text-xs">No activity recorded yet.</div>
            ) : recentExecutionLogs.map((log) => (
              <div key={log.id} className="flex items-start gap-2 py-2 border-b border-slate-800/70 last:border-b-0">
                {log.status === 'success' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" /> : log.status === 'blocked' ? <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 text-rose-400 mt-0.5 shrink-0" />}
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-slate-300 break-words">{log.operation}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{log.provider || 'system'}{log.target ? ` • ${log.target}` : ''}</div>
                  {log.safeErrorMessage && <div className="text-[10px] text-amber-400/90 mt-0.5 break-words">{log.safeErrorMessage}</div>}
                </div>
              </div>
            ))}
          </div>

          {taskProof && (
            <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-3">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-emerald-400 mb-2">Verified operation</div>
              <div className="text-xs text-slate-200 font-medium">{taskProof.operation}</div>
              <div className="text-[10px] text-slate-500 mt-1">Recorded {new Date(taskProof.timestamp).toLocaleTimeString()}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
