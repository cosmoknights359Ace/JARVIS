import React from 'react';
import {
  Plus,
  MessageSquare,
  RefreshCw,
  PanelRightClose,
  PanelRightOpen
} from 'lucide-react';
import { NavView, ChatSession, SystemStats } from '../types';

interface SidebarProps {
  currentView: NavView;
  onSelectView: (view: NavView) => void;
  onNewChat: () => void;
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  stats: SystemStats;
  onRefreshOllama: () => void;
  showInspector: boolean;
  onToggleInspector: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onSelectView,
  onNewChat,
  sessions,
  activeSessionId,
  onSelectSession,
  stats,
  onRefreshOllama,
  showInspector,
  onToggleInspector
}) => {
  return (
    <aside className="w-60 shrink-0 bg-[#0A0A0D] border-r border-zinc-900 flex flex-col justify-between p-4 select-none overflow-y-auto">
      <div className="space-y-6">
        {/* New Chat + Context Dock Toggle */}
        <div className="flex items-center gap-2">
          <button
            id="newChatBtn"
            onClick={onNewChat}
            className="flex-1 py-2 px-3 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/30 text-xs font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
          >
            <Plus size={14} className="text-orange-500" />
            New Chat
          </button>
          <button
            onClick={onToggleInspector}
            title={showInspector ? 'Hide Command & Memory Dock' : 'Show Command & Memory Dock'}
            className={`p-2 rounded-lg border text-xs transition-colors ${
              showInspector
                ? 'bg-orange-500/15 border-orange-500/40 text-orange-400'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {showInspector ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          </button>
        </div>

        {/* Mobile View Switcher */}
        <div className="md:hidden space-y-1">
          <div className="text-[11px] font-medium text-zinc-500 px-2 pb-1">
            Navigation
          </div>
          {(['CHAT', 'HOME', 'VISION', 'MEMORY', 'SETTINGS'] as NavView[]).map((v) => (
            <button
              key={v}
              onClick={() => onSelectView(v)}
              className={`w-full text-left px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                currentView === v
                  ? 'bg-orange-500/15 text-orange-400'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              {v === 'HOME'
                ? 'Overview'
                : v === 'CHAT'
                ? 'Assistant'
                : v.charAt(0) + v.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {/* Recent Sessions */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-medium text-zinc-500">
              Recent Chats
            </span>
            <span className="text-xs font-mono text-zinc-600 tabular-nums">
              {sessions.length}
            </span>
          </div>

          <ul id="recentList" className="space-y-1">
            {sessions.slice(0, 8).map((s) => {
              const isActive = s.id === activeSessionId && currentView === 'CHAT';
              return (
                <li key={s.id}>
                  <button
                    onClick={() => {
                      onSelectSession(s.id);
                      onSelectView('CHAT');
                    }}
                    title={s.title}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-left transition-colors ${
                      isActive
                        ? 'bg-zinc-900 text-orange-400 border border-zinc-800 font-medium'
                        : 'text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200'
                    }`}
                  >
                    <MessageSquare size={13} className="shrink-0 opacity-70" />
                    <span className="truncate">{s.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Bottom AI Core Telemetry Card */}
      <div className="pt-4 border-t border-zinc-900">
        <div className="p-3 rounded-lg bg-[#070709] border border-zinc-900 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-300">
              AI Core
            </span>
            <button
              onClick={onRefreshOllama}
              title="Check Ollama connection"
              className="text-xs text-zinc-500 hover:text-orange-400 flex items-center gap-1 transition-colors"
            >
              <RefreshCw size={11} />
              <span>Sync</span>
            </button>
          </div>

          <div className="text-xs text-zinc-400 flex items-center justify-between">
            <span>Status</span>
            <span
              className={`font-mono font-medium ${
                stats.ollamaReachable ? 'text-emerald-400' : 'text-orange-400'
              }`}
            >
              {stats.ollamaReachable ? 'Ollama Online' : 'Built-in Core'}
            </span>
          </div>

          <div className="text-xs text-zinc-400 flex items-center justify-between">
            <span>Model Route</span>
            <span className="font-mono text-zinc-200 truncate max-w-[115px]">
              {stats.resolvedModel}
            </span>
          </div>

          <div className="space-y-2 pt-1.5 border-t border-zinc-900">
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-zinc-500">
                <span>Core Load</span>
                <span className="font-mono text-zinc-300 tabular-nums">{stats.cpu}%</span>
              </div>
              <div className="h-1 w-full bg-zinc-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-orange-500 transition-transform duration-300 origin-left"
                  style={{ transform: `scaleX(${stats.cpu / 100})` }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-zinc-500">
                <span>Memory Alloc</span>
                <span className="font-mono text-zinc-300 tabular-nums">{stats.ram}%</span>
              </div>
              <div className="h-1 w-full bg-zinc-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-orange-500 transition-transform duration-300 origin-left"
                  style={{ transform: `scaleX(${stats.ram / 100})` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
