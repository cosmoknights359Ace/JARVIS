import React from 'react';
import {
  Terminal,
  Cpu,
  Eye,
  Database,
  Calculator,
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
  onQuickAction: (command: string) => void;
  onOpenCapabilities: () => void;
  onRefreshOllama: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  onSelectView,
  stats,
  memory,
  settings,
  onQuickAction,
  onOpenCapabilities,
  onRefreshOllama
}) => {
  const memoryEntries = Object.entries(memory);

  return (
    <section className="flex-1 overflow-y-auto p-6 md:p-8 bg-[#070709]" id="view-HOME">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Hero Split with Fade-In/Fade-Out Triangle */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch bg-[#111115] border border-zinc-800/90 rounded-2xl p-6">
          <div className="lg:col-span-8 flex flex-col justify-between space-y-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <span>AI Core</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-orange-400">{stats.resolvedModel}</span>
                <span aria-hidden="true">·</span>
                <span
                  className={
                    stats.ollamaReachable ? 'text-emerald-400 font-medium' : 'text-orange-400'
                  }
                >
                  {stats.ollamaReachable ? 'Ollama Connected' : 'Built-in Core Active'}
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl font-display font-bold text-zinc-100 tracking-tight">
                J.A.R.V.I.S Assistant Console
              </h1>

              <p className="text-sm text-zinc-400 leading-relaxed max-w-2xl">
                Futuristic command interface with sticky coder routing, slash-command automation, optical frame analysis, voice synthesis, and persistent key-value memory.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => onSelectView('CHAT')}
                className="px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-black font-semibold text-xs flex items-center gap-2 transition-colors whitespace-nowrap"
              >
                <span>Open Assistant Stage</span>
                <ArrowRight size={14} />
              </button>

              <button
                onClick={onOpenCapabilities}
                className="px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border border-zinc-800 text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap"
              >
                <Sparkles size={14} className="text-orange-500" />
                <span>Commands & Guide</span>
              </button>

              <button
                onClick={onRefreshOllama}
                className="px-3.5 py-2.5 rounded-xl bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <RefreshCw size={13} className="text-orange-500" />
                <span>Sync Ollama</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-4 flex flex-col items-center justify-center border-t lg:border-t-0 lg:border-l border-zinc-800/80 pt-6 lg:pt-0 lg:pl-6">
            <ArcReactor size={138} pulsing={true} />
            <div className="mt-3 text-center">
              <div className="text-xs font-mono font-semibold text-zinc-200 tabular-nums">
                LOAD {stats.cpu}% · MEM {stats.ram}%
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5 font-mono tabular-nums">
                {stats.clock}
              </div>
            </div>
          </div>
        </div>

        {/* 4-Column Metric Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-[#111115] border border-zinc-800/90">
            <div className="text-xs text-zinc-400">Active Route</div>
            <div className="text-base font-mono font-semibold text-zinc-100 mt-1 truncate">
              {stats.resolvedModel}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              Sticky 3-turn code router
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#111115] border border-zinc-800/90">
            <div className="text-xs text-zinc-400">Coder Engine</div>
            <div className="text-base font-mono font-semibold text-orange-400 mt-1 truncate">
              {settings.codingModel}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              Auto-selected on code keywords
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#111115] border border-zinc-800/90">
            <div className="text-xs text-zinc-400">Memory Bank</div>
            <div className="text-base font-mono font-semibold text-zinc-100 mt-1 tabular-nums">
              {memoryEntries.length} Facts
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              Injected into system prompt
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#111115] border border-zinc-800/90">
            <div className="text-xs text-zinc-400">Keep-Alive</div>
            <div className="text-base font-mono font-semibold text-zinc-100 mt-1 tabular-nums">
              {settings.keepAliveMinutes} min
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              Warm model retention
            </div>
          </div>
        </div>

        {/* 1-Click Command Cards */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-display font-semibold text-zinc-100">
              1-Click Instant Commands
            </h2>
            <span className="text-xs text-zinc-500">
              Click any card to execute immediately
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: <Terminal size={18} className="text-orange-500" />,
                title: 'Run Diagnostics (/status)',
                desc: 'Check active AI engine status, memory count, and routing mode',
                onClick: () => onQuickAction('/status')
              },
              {
                icon: <Cpu size={18} className="text-orange-500" />,
                title: 'Code Synthesis (/code)',
                desc: 'Switches to qwen2.5-coder:7b and generates an async Python worker pool',
                onClick: () =>
                  onQuickAction('Write a clean Python async task queue with worker pool and retry logic')
              },
              {
                icon: <Calculator size={18} className="text-orange-500" />,
                title: 'Instant Math (/calc)',
                desc: 'Evaluate mathematical expressions with zero latency',
                onClick: () => onQuickAction('calc (256 * 16) + 1024')
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
                desc: 'Customize model routes, temperature, and TTS voice output',
                onClick: () => onSelectView('SETTINGS')
              }
            ].map((item, idx) => (
              <button
                key={idx}
                onClick={item.onClick}
                className="flex items-start gap-3.5 p-4 rounded-xl bg-[#111115] hover:bg-zinc-900 border border-zinc-800/90 hover:border-orange-500/40 text-left transition-colors group"
              >
                <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 group-hover:border-orange-500/40 shrink-0">
                  {item.icon}
                </div>
                <div>
                  <div className="text-sm font-semibold text-zinc-100 group-hover:text-orange-400 transition-colors">
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
                    className="flex items-center justify-between px-4 py-3 text-xs"
                  >
                    <span className="font-mono font-semibold text-orange-400 w-48 truncate">
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
