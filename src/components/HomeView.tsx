import React from 'react';
import {
  Terminal,
  Cpu,
  Eye,
  Database,
  FileSpreadsheet,
  Sparkles,
  ArrowRight,
  RefreshCw
} from 'lucide-react';
import { NavView, SystemStats, MemoryStore, JarvisSettings } from '../types';
import { ArcReactor } from './ArcReactor';
import { getShort } from '../services/attribution';

interface HomeViewProps {
  onSelectView: (view: NavView) => void;
  stats: SystemStats;
  memory: MemoryStore;
  settings: JarvisSettings;
  sessionCount: number;
  onQuickAction: (command: string) => void;
  onOpenCapabilities: () => void;
  onRefreshOllama: () => void;
}

function formatUptime(sec: number | null): string {
  if (sec === null) return '—';
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const rem = sec % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${rem}s`;
  return `${rem}s`;
}

export const HomeView: React.FC<HomeViewProps> = ({
  onSelectView,
  stats,
  memory,
  settings,
  sessionCount,
  onQuickAction,
  onOpenCapabilities,
  onRefreshOllama
}) => {
  const memoryEntries = Object.entries(memory);

  const providerTitle =
    stats.activeProvider === 'ollama'
      ? 'Local Ollama Connected'
      : stats.activeProvider === 'gemini'
      ? 'Gemini Cloud Ready'
      : 'Engine Offline';

  const providerTone =
    stats.activeProvider === 'ollama'
      ? 'text-emerald-400 font-medium'
      : stats.activeProvider === 'gemini'
      ? 'text-orange-400 font-medium'
      : 'text-rose-400 font-medium';

  return (
    <section className="flex-1 overflow-y-auto p-6 md:p-8 bg-[#070709]" id="view-HOME">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Hero Split with Fade-In/Fade-Out Triangle */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch bg-[#111115] border border-zinc-800/90 rounded-2xl p-6">
          <div className="lg:col-span-8 flex flex-col justify-between space-y-6">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span>AI Engine</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-orange-400">{stats.resolvedModel}</span>
                <span aria-hidden="true">·</span>
                <span className={providerTone}>{providerTitle}</span>
              </div>

              <h1 className="text-2xl sm:text-3xl font-display font-bold text-zinc-100 tracking-tight text-balance">
                J.A.R.V.I.S Assistant Console
              </h1>

              <p className="text-sm text-zinc-400 leading-relaxed max-w-2xl">
                Hybrid local-and-cloud command workstation with sticky coder routing, rich Markdown and code synthesis, slash-command automation, optical inspection, and persistent memory.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onSelectView('CHAT')}
                className="px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-black font-semibold text-xs flex items-center gap-2 transition-colors whitespace-nowrap"
              >
                <span>Open Assistant Stage</span>
                <ArrowRight size={14} />
              </button>

              <button
                type="button"
                onClick={() => onSelectView('XFILL')}
                className="px-4 py-2.5 rounded-xl bg-orange-500/12 hover:bg-orange-500/20 text-orange-400 border border-orange-500/45 text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap"
              >
                <FileSpreadsheet size={14} className="text-orange-400" />
                <span>Launch Xfill Auto-Fill</span>
              </button>

              <button
                type="button"
                onClick={onOpenCapabilities}
                className="px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border border-zinc-800 text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap"
              >
                <Sparkles size={14} className="text-orange-500" />
                <span>Commands & Guide</span>
              </button>

              <button
                type="button"
                onClick={onRefreshOllama}
                className="px-3.5 py-2.5 rounded-xl bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <RefreshCw size={13} className="text-orange-500" />
                <span>Probe Engine</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-4 flex flex-col items-center justify-center border-t lg:border-t-0 lg:border-l border-zinc-800/80 pt-6 lg:pt-0 lg:pl-6">
            <ArcReactor size={138} pulsing={true} />
            <div className="mt-3 text-center space-y-0.5">
              <div className="text-xs font-mono font-semibold text-zinc-200 tabular-nums">
                {stats.probeLatencyMs !== null ? `PING ${stats.probeLatencyMs}ms` : 'PING —'} · UP {formatUptime(stats.serverUptimeSec)}
              </div>
              <div className="text-[11px] text-zinc-500 font-mono tabular-nums">
                {stats.clock}
              </div>
            </div>
          </div>
        </div>

        {/* 4-Column Real Telemetry Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-[#111115] border border-zinc-800/90">
            <div className="text-xs text-zinc-400">Active Provider</div>
            <div className={`text-base font-mono font-semibold mt-1 truncate ${providerTone}`}>
              {stats.activeProvider === 'ollama'
                ? 'Local Ollama'
                : stats.activeProvider === 'gemini'
                ? 'Gemini Cloud'
                : 'Offline'}
            </div>
            <div className="text-xs text-zinc-500 mt-1 tabular-nums">
              {stats.ollamaReachable
                ? `${stats.installedModels.length} local models`
                : stats.geminiAvailable
                ? 'gemini-4-hydrogen'
                : 'No provider linked'}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#111115] border border-zinc-800/90">
            <div className="text-xs text-zinc-400">Inference Speed</div>
            <div className="text-base font-mono font-semibold text-zinc-100 mt-1 tabular-nums">
              {stats.lastTokensPerSec !== null ? `${stats.lastTokensPerSec} tok/s` : 'Awaiting turn'}
            </div>
            <div className="text-xs text-zinc-500 mt-1 tabular-nums">
              {stats.lastTtftMs !== null
                ? `TTFT ${stats.lastTtftMs}ms · ${stats.lastElapsedMs ?? 0}ms total`
                : 'Measured per response'}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#111115] border border-zinc-800/90">
            <div className="text-xs text-zinc-400">Memory Bank</div>
            <div className="text-base font-mono font-semibold text-zinc-100 mt-1 tabular-nums">
              {memoryEntries.length} {memoryEntries.length === 1 ? 'Fact' : 'Facts'}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              Injected into system prompt
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#111115] border border-zinc-800/90">
            <div className="text-xs text-zinc-400">Saved Sessions</div>
            <div className="text-base font-mono font-semibold text-zinc-100 mt-1 tabular-nums">
              {sessionCount} {sessionCount === 1 ? 'Chat' : 'Chats'}
            </div>
            <div className="text-xs text-zinc-500 mt-1 truncate">
              Coder route: {settings.codingModel}
            </div>
          </div>
        </div>

        {/* 1-Click Command Cards */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-display font-semibold text-zinc-100">
              Quick Actions
            </h2>
            <span className="text-xs text-zinc-500">
              Click any card to execute immediately
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: <FileSpreadsheet size={18} className="text-orange-400" />,
                title: 'Xfill Document Auto-Fill',
                desc: 'Upload DOCX, XLSX, or PPTX forms to detect fields, ground accurate answers, and export formatted files',
                featured: true,
                onClick: () => onSelectView('XFILL')
              },
              {
                icon: <Terminal size={18} className="text-orange-500" />,
                title: 'Run Diagnostics (/status)',
                desc: 'Inspect active AI provider, probe ping, latency, and memory count',
                onClick: () => onQuickAction('/status')
              },
              {
                icon: <Cpu size={18} className="text-orange-500" />,
                title: 'Code Synthesis (/code)',
                desc: `Routes to ${settings.codingModel} and generates an async Python worker pool`,
                onClick: () =>
                  onQuickAction('Write a clean Python async task queue with worker pool and retry logic')
              },
              {
                icon: <Database size={18} className="text-orange-500" />,
                title: 'Memory Bank (/memory)',
                desc: 'Add, search, or export persistent key-value facts',
                onClick: () => onSelectView('MEMORY')
              },
              {
                icon: <Eye size={18} className="text-orange-500" />,
                title: 'Vision Frame Analyzer',
                desc: 'Inspect schematics or uploaded images with the vision model',
                onClick: () => onSelectView('VISION')
              },
              {
                icon: <Sparkles size={18} className="text-orange-500" />,
                title: 'Configure Engine & Voice',
                desc: 'Customize model routes, keep-alive window, and TTS voice output',
                onClick: () => onSelectView('SETTINGS')
              }
            ].map((item, idx) => (
              <button
                type="button"
                key={idx}
                onClick={item.onClick}
                className={`flex items-start gap-3.5 p-4 rounded-xl text-left transition-colors group border ${
                  item.featured
                    ? 'bg-orange-500/8 hover:bg-orange-500/14 border-orange-500/40 hover:border-orange-400'
                    : 'bg-[#111115] hover:bg-zinc-900 border-zinc-800/90 hover:border-orange-500/40'
                }`}
              >
                <div
                  className={`p-2.5 rounded-lg border shrink-0 ${
                    item.featured
                      ? 'bg-orange-500/15 border-orange-500/40'
                      : 'bg-zinc-900 border-zinc-800 group-hover:border-orange-500/40'
                  }`}
                >
                  {item.icon}
                </div>
                <div>
                  <div
                    className={`text-sm font-semibold transition-colors ${
                      item.featured
                        ? 'text-orange-300 group-hover:text-orange-200'
                        : 'text-zinc-100 group-hover:text-orange-400'
                    }`}
                  >
                    {item.title}
                  </div>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Active Memory Table */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-display font-semibold text-zinc-100">
              Active Memory Context
            </h2>
            <button
              type="button"
              onClick={() => onSelectView('MEMORY')}
              className="text-xs font-medium text-orange-400 hover:text-orange-300 transition-colors"
            >
              Manage All ({memoryEntries.length}) →
            </button>
          </div>

          <div className="border border-zinc-800/90 rounded-xl bg-[#111115] overflow-hidden">
            {memoryEntries.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-500">
                No memories stored yet. Use <code className="font-mono text-orange-400">remember key=value</code> in chat.
              </div>
            ) : (
              <div className="divide-y divide-zinc-900">
                {memoryEntries.slice(0, 5).map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-center justify-between gap-4 px-4 py-3 text-xs"
                  >
                    <span className="font-mono font-semibold text-orange-400 w-44 sm:w-48 truncate">
                      {k}
                    </span>
                    <span className="text-zinc-300 flex-1 truncate">{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quiet Footer */}
        <div className="pt-4 border-t border-zinc-900 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-zinc-500">
          <span>{getShort()}</span>
          <span>Permissive license — creator attribution required on reuse</span>
        </div>
      </div>
    </section>
  );
};
