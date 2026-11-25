import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  MessageSquare,
  RefreshCw,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Pencil,
  Trash2,
  Check,
  X,
  Sparkles,
  Presentation
} from 'lucide-react';
import { NavView, ChatSession, SystemStats } from '../types';

interface SidebarProps {
  currentView: NavView;
  onSelectView: (view: NavView) => void;
  onNewChat: () => void;
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string, newTitle: string) => void;
  onDeleteSession: (id: string) => void;
  stats: SystemStats;
  onRefreshOllama: () => void;
  showInspector: boolean;
  onToggleInspector: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function formatRelativeTime(isoString?: string): string {
  if (!isoString) return 'Just now';
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / 1000));
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onSelectView,
  onNewChat,
  sessions,
  activeSessionId,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  stats,
  onRefreshOllama,
  showInspector,
  onToggleInspector,
  mobileOpen,
  onCloseMobile
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseMobile();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen, onCloseMobile]);

  const filteredSessions = sessions.filter((s) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      s.title.toLowerCase().includes(q) ||
      s.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  });

  const startRename = (s: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(s.id);
    setEditingTitle(s.title);
  };

  const commitRename = () => {
    if (editingId && editingTitle.trim()) {
      onRenameSession(editingId, editingTitle.trim());
    }
    setEditingId(null);
    setEditingTitle('');
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditingTitle('');
  };

  const providerLabel =
    stats.activeProvider === 'ollama'
      ? 'Local Ollama'
      : stats.activeProvider === 'gemini'
      ? 'Gemini Cloud'
      : 'Offline';

  const providerColor =
    stats.activeProvider === 'ollama'
      ? 'text-emerald-400'
      : stats.activeProvider === 'gemini'
      ? 'text-orange-400'
      : 'text-rose-400';

  const sidebarContent = (
    <div className="h-full flex flex-col justify-between p-4 select-none overflow-y-auto">
      <div className="space-y-5 min-h-0 flex flex-col flex-1">
        {/* Mobile Drawer Header */}
        <div className="flex lg:hidden items-center justify-between pb-2 border-b border-zinc-900">
          <span className="text-sm font-display font-bold tracking-widest text-orange-500">
            J.A.R.V.I.S
          </span>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation menu"
            className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* New Chat + Context Dock Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            id="newChatBtn"
            onClick={() => {
              onNewChat();
              onCloseMobile();
            }}
            className="flex-1 py-2 px-3 rounded-lg bg-orange-500/12 hover:bg-orange-500/20 text-orange-400 border border-orange-500/30 text-xs font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
          >
            <Plus size={14} className="text-orange-500" />
            New Chat
          </button>
          <button
            type="button"
            onClick={onToggleInspector}
            title={showInspector ? 'Hide Memory Dock' : 'Show Memory Dock'}
            aria-label={showInspector ? 'Hide Memory Dock' : 'Show Memory Dock'}
            className={`hidden xl:flex p-2 rounded-lg border text-xs transition-colors ${
              showInspector
                ? 'bg-orange-500/15 border-orange-500/40 text-orange-400'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {showInspector ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          </button>
        </div>

        {/* Mobile View Switcher (< md where topbar links hide) */}
        <div className="md:hidden space-y-1 shrink-0">
          <div className="text-[11px] font-medium text-zinc-500 px-2 pb-1">
            Views
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {(['CHAT', 'XFILL', 'SLIDES', 'SETTINGS'] as NavView[]).map((v) => {
              const isActive = currentView === v;
              const isFeatured = v === 'XFILL' || v === 'SLIDES';
              return (
                <button
                  type="button"
                  key={v}
                  onClick={() => {
                    onSelectView(v);
                    onCloseMobile();
                  }}
                  className={`text-left px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap flex items-center gap-1.5 ${
                    isFeatured
                      ? isActive
                        ? 'bg-cyan-400 text-black font-semibold border border-cyan-300 shadow-[0_0_16px_rgba(34,211,238,0.5)]'
                        : 'bg-cyan-400/10 text-cyan-300 font-semibold border border-cyan-400/60 hover:bg-cyan-400/20 shadow-[0_0_12px_rgba(34,211,238,0.22)]'
                      : isActive
                      ? 'bg-orange-500/15 text-orange-400 border border-orange-500/30'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-transparent'
                  }`}
                >
                  {v === 'XFILL' && <Sparkles size={12} className={isActive ? 'text-black' : 'text-cyan-300'} />}
                  {v === 'SLIDES' && <Presentation size={12} className={isActive ? 'text-black' : 'text-cyan-300'} />}
                  <span>
                    {v === 'CHAT'
                      ? 'Assistant'
                      : v === 'XFILL'
                      ? 'Xfill'
                      : v === 'SLIDES'
                      ? 'Xslide'
                      : 'Settings'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Session Search + History List */}
        <div className="space-y-2.5 flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between px-1 shrink-0">
            <span className="text-xs font-medium text-zinc-400">
              Conversations
            </span>
            <span className="text-xs font-mono text-zinc-500 tabular-nums">
              {sessions.length}
            </span>
          </div>

          <div className="relative shrink-0">
            <Search size={13} className="absolute left-2.5 top-2.5 text-zinc-500 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter chats..."
              aria-label="Filter chat sessions"
              className="w-full bg-[#070709] border border-zinc-800/90 rounded-lg pl-8 pr-7 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/70 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-2 text-zinc-500 hover:text-zinc-200"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <ul id="recentList" className="space-y-1 overflow-y-auto flex-1 pr-0.5">
            {filteredSessions.length === 0 ? (
              <li className="px-2.5 py-4 text-xs text-zinc-500 text-center">
                No matching conversations.
              </li>
            ) : (
              filteredSessions.map((s) => {
                const isActive = s.id === activeSessionId && currentView === 'CHAT';
                const isEditing = editingId === s.id;
                const msgCount = s.messages.length;

                return (
                  <li key={s.id} className="group relative">
                    {isEditing ? (
                      <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-zinc-900 border border-orange-500/50">
                        <input
                          ref={renameInputRef}
                          type="text"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitRename();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelRename();
                            }
                          }}
                          className="flex-1 min-w-0 bg-transparent text-xs text-zinc-100 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={commitRename}
                          aria-label="Save title"
                          className="p-1 text-emerald-400 hover:text-emerald-300"
                        >
                          <Check size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={cancelRename}
                          aria-label="Cancel rename"
                          className="p-1 text-zinc-400 hover:text-zinc-200"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <div
                        className={`flex items-center gap-1.5 rounded-lg border transition-colors ${
                          isActive
                            ? 'bg-zinc-900/95 border-zinc-800 text-orange-400'
                            : 'border-transparent text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-200'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelectSession(s.id);
                            onSelectView('CHAT');
                            onCloseMobile();
                          }}
                          title={s.title}
                          className="flex-1 min-w-0 flex items-start gap-2 px-2.5 py-2 text-left"
                        >
                          <MessageSquare
                            size={13}
                            className={`shrink-0 mt-0.5 ${isActive ? 'text-orange-400' : 'opacity-60'}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div
                              className={`text-xs truncate ${
                                isActive ? 'font-medium text-zinc-100' : ''
                              }`}
                            >
                              {s.title}
                            </div>
                            <div className="text-[11px] text-zinc-500 flex items-center gap-1.5 mt-0.5 tabular-nums">
                              <span>{msgCount} {msgCount === 1 ? 'msg' : 'msgs'}</span>
                              <span aria-hidden="true">·</span>
                              <span>{formatRelativeTime(s.updatedAt || s.createdAt)}</span>
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center pr-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity shrink-0">
                          <button
                            type="button"
                            onClick={(e) => startRename(s, e)}
                            title="Rename conversation"
                            aria-label={`Rename ${s.title}`}
                            className="p-1.5 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteSession(s.id);
                            }}
                            title="Delete conversation"
                            aria-label={`Delete ${s.title}`}
                            className="p-1.5 rounded text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition-colors"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </div>

      {/* Bottom Real Engine Diagnostics Panel */}
      <div className="pt-4 mt-4 border-t border-zinc-900 shrink-0">
        <div className="p-3 rounded-xl bg-[#070709] border border-zinc-800/90 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-display font-semibold text-zinc-200">
              Engine Diagnostics
            </span>
            <button
              type="button"
              onClick={onRefreshOllama}
              title="Re-probe local Ollama and cloud engine"
              className="text-xs text-zinc-400 hover:text-orange-400 flex items-center gap-1 transition-colors whitespace-nowrap"
            >
              <RefreshCw size={11} />
              <span>Probe</span>
            </button>
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-zinc-500">Provider</span>
              <span className={`font-mono font-medium ${providerColor} truncate`}>
                {providerLabel}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-zinc-500">Route</span>
              <span className="font-mono text-zinc-200 truncate max-w-[125px]">
                {stats.resolvedModel}
              </span>
            </div>

            {stats.warmUpStatus === 'warming' ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-500">VRAM</span>
                  <span className="font-mono text-[10px] text-orange-400/90">Loading</span>
                </div>
                <div
                  data-testid="diagnostics-warmup-status"
                  className="inline-flex items-center gap-1.5 w-full px-2 py-1 rounded-lg bg-orange-500/12 border border-orange-500/35 font-mono text-[11px] text-orange-300"
                  title={`Warming up ${stats.warmUpModel || 'local model'}...`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse shrink-0" />
                  <span className="truncate">
                    Warming up {stats.warmUpModel || 'model'}...
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-500">VRAM</span>
                {stats.warmUpStatus === 'ready' || stats.activeProvider !== 'offline' ? (
                  <span
                    data-testid="diagnostics-warmup-status"
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 font-mono text-[11px] text-emerald-400"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <span>Ready</span>
                  </span>
                ) : (
                  <span
                    data-testid="diagnostics-warmup-status"
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-zinc-500"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0" />
                    <span>Offline</span>
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-zinc-900">
              <span className="text-zinc-500">Probe Ping</span>
              <span className="font-mono text-zinc-300 tabular-nums">
                {stats.probeLatencyMs !== null ? `${stats.probeLatencyMs} ms` : '—'}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-zinc-500">Last TTFT</span>
              <span className="font-mono text-zinc-300 tabular-nums">
                {stats.lastTtftMs !== null ? `${stats.lastTtftMs} ms` : '—'}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-zinc-500">Throughput</span>
              <span className="font-mono text-zinc-300 tabular-nums">
                {stats.lastTokensPerSec !== null ? `${stats.lastTokensPerSec} tok/s` : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Static Sidebar Rail (lg+) */}
      <aside className="hidden lg:flex w-64 shrink-0 bg-[#0A0A0D] border-r border-zinc-900 flex-col">
        {sidebarContent}
      </aside>

      {/* Mobile / Tablet Slide-Over Drawer (< lg) */}
      <div
        className={`fixed inset-0 z-40 lg:hidden transition-opacity duration-200 ${
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden={!mobileOpen}
      >
        <div
          className="absolute inset-0 bg-black/75 backdrop-blur-xs"
          onClick={onCloseMobile}
        />
        <aside
          className={`relative w-72 max-w-[85vw] h-full bg-[#0A0A0D] border-r border-zinc-800 shadow-2xl transform transition-transform duration-200 ease-out ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {sidebarContent}
        </aside>
      </div>
    </>
  );
};
