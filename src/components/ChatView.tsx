import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  Square,
  Mic,
  MicOff,
  Plus,
  Copy,
  RefreshCw,
  FileDown,
  Image as ImageIcon,
  Check,
  Terminal,
  Trash2,
  Radio,
  Command,
  Volume2,
  VolumeX,
  Pencil,
  ArrowDown,
  AlertTriangle,
  PanelRightClose,
  PanelRightOpen
} from 'lucide-react';
import { ChatMessage, JarvisSettings, MemoryStore, SystemStats } from '../types';
import { QUICK_SLASH_COMMANDS, QuickSlashCommand } from '../services/jarvisBrain';
import { DictationService, SpeechService } from '../services/speech';
import { sfx } from '../services/soundEffects';
import { ArcReactor } from './ArcReactor';
import { MarkdownRenderer } from './MarkdownRenderer';

interface ChatViewProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
  onStopStreaming: () => void;
  onRegenerate: () => void;
  onEditMessage: (messageId: string, newText: string) => void;
  onExportChat: () => void;
  onClearScreen: () => void;
  onOpenVision: () => void;
  onOpenCapabilities: () => void;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  settings: JarvisSettings;
  onUpdateSettings: (newSettings: JarvisSettings) => void;
  memory: MemoryStore;
  onUpdateMemory: (newMem: MemoryStore) => void;
  stats: SystemStats;
  showInspector: boolean;
  onToggleInspector: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  isStreaming,
  onSendMessage,
  onStopStreaming,
  onRegenerate,
  onEditMessage,
  onExportChat,
  onClearScreen,
  onOpenVision,
  onOpenCapabilities,
  selectedModel,
  onSelectModel,
  settings,
  onUpdateSettings,
  memory,
  onUpdateMemory,
  stats,
  showInspector,
  onToggleInspector
}) => {
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [quickMemKey, setQuickMemKey] = useState('');
  const [quickMemVal, setQuickMemVal] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const [isNearBottom, setIsNearBottom] = useState(true);

  // Input history buffer (Up/Down arrow key support)
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const userHistoryRef = useRef<string[]>([]);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  // Auto-grow textarea smoothly up to 180px
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [inputText, resizeTextarea]);

  // Smart auto-scroll: only stick to bottom if user hasn't scrolled up to read earlier messages
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el || !isNearBottom) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming, isNearBottom]);

  // Close attach menu on outside click
  useEffect(() => {
    if (!showAttachMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setShowAttachMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showAttachMenu]);

  const handleScroll = () => {
    const el = chatScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsNearBottom(distanceFromBottom < 80);
  };

  const scrollToLatest = () => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setIsNearBottom(true);
  };

  // Slash command filtering when single-line input starts with "/"
  const isSlashActive = inputText.startsWith('/') && !inputText.includes('\n');
  const filteredSlashCommands = isSlashActive
    ? QUICK_SLASH_COMMANDS.filter(
        (c) =>
          c.slash.toLowerCase().includes(inputText.toLowerCase()) ||
          c.label.toLowerCase().includes(inputText.slice(1).toLowerCase())
      )
    : [];

  useEffect(() => {
    setSlashIndex(0);
  }, [inputText]);

  const triggerQuickCommand = (cmd: QuickSlashCommand) => {
    sfx.playClick();
    if (cmd.needsArg && cmd.placeholder) {
      setInputText(cmd.placeholder);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } else {
      setInputText('');
      setIsNearBottom(true);
      onSendMessage(cmd.command);
    }
  };

  const handleSend = () => {
    const trimmed = inputText.trim();
    if (!trimmed || isStreaming) return;

    sfx.playClick();
    userHistoryRef.current.push(trimmed);
    setHistoryIndex(-1);
    setInputText('');
    setIsNearBottom(true);
    onSendMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash menu keyboard navigation
    if (isSlashActive && filteredSlashCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((prev) => (prev + 1) % filteredSlashCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex(
          (prev) => (prev - 1 + filteredSlashCommands.length) % filteredSlashCommands.length
        );
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        triggerQuickCommand(filteredSlashCommands[slashIndex] || filteredSlashCommands[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setInputText('');
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }

    const el = e.currentTarget;
    const isAtStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const isAtEnd =
      el.selectionStart === inputText.length && el.selectionEnd === inputText.length;

    if (e.key === 'ArrowUp' && isAtStart && !inputText.includes('\n')) {
      if (userHistoryRef.current.length === 0) return;
      e.preventDefault();
      const nextIdx =
        historyIndex === -1
          ? userHistoryRef.current.length - 1
          : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIdx);
      setInputText(userHistoryRef.current[nextIdx]);
    } else if (e.key === 'ArrowDown' && isAtEnd && historyIndex !== -1) {
      if (userHistoryRef.current.length === 0) return;
      e.preventDefault();
      const nextIdx = historyIndex + 1;
      if (nextIdx >= userHistoryRef.current.length) {
        setHistoryIndex(-1);
        setInputText('');
      } else {
        setHistoryIndex(nextIdx);
        setInputText(userHistoryRef.current[nextIdx]);
      }
    } else if (e.key === 'Escape' && inputText) {
      setInputText('');
      setHistoryIndex(-1);
    }
  };

  const toggleMic = () => {
    sfx.playWakeTone();
    if (isListening) {
      DictationService.stop();
      setIsListening(false);
    } else {
      const started = DictationService.start(
        (transcript, isFinal) => {
          if (isFinal && settings.handsFreeMode) {
            onSendMessage(transcript.trim());
            setInputText('');
          } else {
            setInputText((prev) => (isFinal ? (prev + ' ' + transcript).trim() : transcript));
          }
        },
        (listening) => setIsListening(listening),
        () => setIsListening(false)
      );
      if (!started) {
        setInputText('Voice recognition requires Chromium browser permissions.');
      }
    }
  };

  const handleCopyMessage = (content: string, id: string) => {
    navigator.clipboard.writeText(content).catch(() => {});
    setCopiedMsgId(id);
    setTimeout(() => setCopiedMsgId(null), 1800);
  };

  const handleSpeakMessage = (msg: ChatMessage) => {
    if (speakingMsgId === msg.id) {
      SpeechService.stop();
      setSpeakingMsgId(null);
      return;
    }
    setSpeakingMsgId(msg.id);
    SpeechService.speak(msg.content, {
      voiceName: settings.preferredVoice,
      rate: settings.voiceRate,
      pitch: settings.voicePitch,
      onEnd: () => setSpeakingMsgId(null),
      onError: () => setSpeakingMsgId(null)
    });
  };

  const stopAllSpeech = () => {
    SpeechService.stop();
    setSpeakingMsgId(null);
  };

  const startEditMessage = (msg: ChatMessage) => {
    setEditingMsgId(msg.id);
    setEditingText(msg.content);
  };

  const commitEditMessage = () => {
    if (!editingMsgId) return;
    const trimmed = editingText.trim();
    if (!trimmed || isStreaming) return;
    const targetId = editingMsgId;
    setEditingMsgId(null);
    setEditingText('');
    setIsNearBottom(true);
    onEditMessage(targetId, trimmed);
  };

  const modelChoices = Array.from(
    new Set(['auto', settings.generalModel, settings.codingModel, ...stats.installedModels])
  );

  const handleQuickAddMemory = (e: React.FormEvent) => {
    e.preventDefault();
    const k = quickMemKey.trim();
    const v = quickMemVal.trim();
    if (!k || !v) return;
    onUpdateMemory({ ...memory, [k]: v });
    setQuickMemKey('');
    setQuickMemVal('');
    sfx.playCommandConfirm();
  };

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assist')?.id;

  const contentMaxWidthClass = showInspector ? 'max-w-3xl' : 'max-w-5xl';

  const renderComposerCard = () => (
    <div className={`w-full ${contentMaxWidthClass} mx-auto space-y-2 relative z-20 transition-[max-width] duration-250 ease-out`}>
      {/* Keyboard-Navigable Slash-Command Autocomplete Menu */}
      {isSlashActive && filteredSlashCommands.length > 0 && (
        <div className="w-full rounded-xl bg-[#0F0F13] border border-orange-500/40 shadow-2xl overflow-hidden divide-y divide-zinc-800/80 mb-2">
          <div className="px-3.5 py-2 bg-zinc-900/80 text-[11px] font-mono text-orange-400 flex items-center justify-between">
            <span>Slash Commands</span>
            <span className="text-zinc-500">↑↓ navigate · Enter or Tab to run</span>
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-zinc-900">
            {filteredSlashCommands.map((cmd, idx) => {
              const highlighted = idx === slashIndex;
              return (
                <button
                  type="button"
                  key={cmd.slash}
                  onMouseEnter={() => setSlashIndex(idx)}
                  onClick={() => triggerQuickCommand(cmd)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${
                    highlighted ? 'bg-orange-500/15' : 'hover:bg-orange-500/10'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <code className="font-mono text-xs font-semibold text-orange-400 w-24 shrink-0">
                      {cmd.slash}
                    </code>
                    <span className="text-xs font-medium text-zinc-200 truncate">
                      {cmd.label}
                    </span>
                    <span className="text-xs text-zinc-500 hidden sm:inline truncate">
                      — {cmd.description}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-zinc-500 shrink-0">
                    {highlighted ? 'Enter ↵' : 'Run'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Multi-Line Elevated Composer Surface */}
      <div className="rounded-2xl bg-[#111115] border border-zinc-800/90 focus-within:border-orange-500/70 shadow-2xl p-3 transition-colors">
        <div className="flex items-start gap-2.5 px-1 py-1">
          <Terminal size={16} className="text-orange-500 shrink-0 mt-1" />
          <textarea
            id="chatInput"
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message J.A.R.V.I.S, paste code, or type / for commands..."
            autoComplete="off"
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none resize-none leading-relaxed max-h-44 overflow-y-auto"
          />
        </div>

        {/* Bottom Composer Control Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 mt-2 border-t border-zinc-800/80">
          {/* Left Controls */}
          <div className="flex items-center gap-1.5">
            <div className="relative" ref={attachMenuRef}>
              <button
                type="button"
                onClick={() => setShowAttachMenu(!showAttachMenu)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-orange-400 hover:bg-zinc-900 transition-colors"
                title="Tools & Actions"
                aria-label="Tools and actions"
              >
                <Plus size={16} />
              </button>

              {showAttachMenu && (
                <div className="absolute bottom-10 left-0 w-52 rounded-xl bg-[#111115] border border-zinc-800 shadow-2xl p-1.5 z-30 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAttachMenu(false);
                      onOpenVision();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-zinc-200 hover:bg-zinc-800 transition-colors text-left"
                  >
                    <ImageIcon size={14} className="text-orange-500" />
                    <span>Vision Frame Analyzer</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAttachMenu(false);
                      onRegenerate();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-zinc-200 hover:bg-zinc-800 transition-colors text-left"
                  >
                    <RefreshCw size={14} className="text-orange-500" />
                    <span>Regenerate Reply</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAttachMenu(false);
                      onExportChat();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-zinc-200 hover:bg-zinc-800 transition-colors text-left"
                  >
                    <FileDown size={14} className="text-orange-500" />
                    <span>Export Session (.md)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAttachMenu(false);
                      onClearScreen();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-zinc-200 hover:bg-zinc-800 transition-colors text-left"
                  >
                    <Trash2 size={14} className="text-orange-500" />
                    <span>Clear Chat</span>
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setInputText('/');
                textareaRef.current?.focus();
              }}
              className="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-mono text-orange-400 flex items-center gap-1 transition-colors whitespace-nowrap"
              title="Open Slash Command Menu"
            >
              <Command size={12} />
              <span>/cmds</span>
            </button>

            <button
              type="button"
              onClick={() =>
                onUpdateSettings({
                  ...settings,
                  handsFreeMode: !settings.handsFreeMode
                })
              }
              className={`px-2.5 py-1 rounded-lg border text-xs flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                settings.handsFreeMode
                  ? 'bg-orange-500/15 border-orange-500/40 text-orange-400 font-medium'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
              title="Auto-send voice input on pause"
            >
              <Radio size={12} />
              <span className="hidden sm:inline">
                Hands-Free: {settings.handsFreeMode ? 'On' : 'Off'}
              </span>
            </button>

            {speakingMsgId && (
              <button
                type="button"
                onClick={stopAllSpeech}
                className="px-2.5 py-1 rounded-lg bg-orange-500/15 border border-orange-500/40 text-orange-300 text-xs flex items-center gap-1.5 transition-colors whitespace-nowrap"
                title="Stop voice playback"
              >
                <VolumeX size={12} />
                <span>Stop Audio</span>
              </button>
            )}
          </div>

          {/* Right Controls: Model Route + Mic + Send/Stop */}
          <div className="flex items-center gap-2">
            <select
              value={selectedModel}
              onChange={(e) => onSelectModel(e.target.value)}
              aria-label="Select AI Model"
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-zinc-300 focus:outline-none focus:border-orange-500 max-w-[175px] truncate shrink-0"
            >
              {modelChoices.map((m) => (
                <option key={m} value={m}>
                  {m === 'auto' ? `auto (${stats.resolvedModel})` : m}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={toggleMic}
              title={isListening ? 'Stop listening' : 'Voice dictation'}
              aria-label="Voice dictation"
              className={`p-1.5 rounded-lg transition-colors shrink-0 ${
                isListening
                  ? 'bg-orange-500 text-black'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900'
              }`}
            >
              {isListening ? <MicOff size={15} /> : <Mic size={15} />}
            </button>

            {isStreaming ? (
              <button
                type="button"
                id="stopBtn"
                onClick={onStopStreaming}
                title="Abort active generation"
                className="px-3.5 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-400 text-black font-semibold text-xs flex items-center gap-1.5 transition-colors shrink-0 whitespace-nowrap"
              >
                <Square size={12} className="fill-current" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="button"
                id="sendBtn"
                onClick={handleSend}
                disabled={!inputText.trim()}
                title="Send message (Enter)"
                className="px-3.5 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-40 disabled:hover:bg-orange-500 text-black font-semibold text-xs flex items-center gap-1.5 transition-colors shrink-0 whitespace-nowrap"
              >
                <Send size={12} />
                <span>Send</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Minimal Single-Line Keyboard Hint */}
      <div className="flex items-center justify-center px-1 text-[11px] text-zinc-500">
        <span>Enter to send · Shift+Enter for new line</span>
      </div>
    </div>
  );

  const providerSummary =
    stats.activeProvider === 'ollama'
      ? `Local Ollama (${stats.resolvedModel})`
      : stats.activeProvider === 'gemini'
      ? `Gemini Cloud · route ${stats.resolvedModel}`
      : 'Engine offline';

  return (
    <div className="flex-1 flex min-h-0 bg-[#070709] relative">
      {/* Primary Stage */}
      <section className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
        {/* Re-open Right Sidebar Toggle when Collapsed (xl+) */}
        {!showInspector && (
          <button
            type="button"
            onClick={onToggleInspector}
            title="Show Memory & Commands Sidebar"
            aria-label="Expand right sidebar"
            className="hidden xl:flex items-center justify-center p-2 rounded-lg bg-[#0A0A0D]/90 hover:bg-zinc-900 border border-zinc-800 hover:border-orange-500/40 text-zinc-400 hover:text-orange-400 shadow-lg transition-colors absolute top-4 right-4 z-30"
          >
            <PanelRightOpen size={15} />
          </button>
        )}

        {/* Whisper-Subtle Ambient Triangle Watermark (4% opacity, static) during active chats */}
        {messages.length > 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            <ArcReactor size={240} isActive={false} pulsing={false} ambient={true} />
          </div>
        )}

        {messages.length === 0 ? (
          /* Centered Zero-State Stage when Session is Fresh */
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-8 flex flex-col items-center justify-center relative z-10">
            <div className={`w-full ${contentMaxWidthClass} mx-auto flex flex-col items-center text-center space-y-6 transition-[max-width] duration-250 ease-out`}>
              <ArcReactor size={150} pulsing={true} />

              <div className="space-y-1.5">
                <h1 className="text-2xl sm:text-3xl font-display font-bold text-zinc-100 tracking-tight text-balance">
                  At your service, Sir.
                </h1>
                <p className="text-xs sm:text-sm text-zinc-400 max-w-lg mx-auto">
                  Engine: <code className="font-mono text-orange-400">{providerSummary}</code>
                  {stats.probeLatencyMs !== null && (
                    <>
                      {' '}· <span className="font-mono tabular-nums">{stats.probeLatencyMs}ms ping</span>
                    </>
                  )}
                </p>
              </div>

              {renderComposerCard()}
            </div>
          </div>
        ) : (
          /* Active Conversation Stream + Bottom Composer */
          <>
            <div
              id="chatScroll"
              ref={chatScrollRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6 relative z-10"
            >
              <div className={`${contentMaxWidthClass} mx-auto space-y-6 transition-[max-width] duration-250 ease-out`}>
                {messages.map((m) => {
                  const isUser = m.role === 'user';
                  const isEditingThis = editingMsgId === m.id;
                  const isLatestAssist = !isUser && m.id === lastAssistantId;

                  return (
                    <div
                      key={m.id}
                      className={`group flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                    >
                      {/* Unboxed Metadata Header (Zero Pills) */}
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 mb-1.5 px-1">
                        <span className="font-semibold text-zinc-300">
                          {isUser ? 'You' : 'J.A.R.V.I.S'}
                        </span>
                        {!isUser && m.model && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-orange-400">{m.model}</span>
                          </>
                        )}
                        {!isUser && typeof m.ttftMs === 'number' && m.ttftMs > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums text-zinc-400">
                              {m.ttftMs}ms
                            </span>
                          </>
                        )}
                        {!isUser && typeof m.tokensPerSec === 'number' && m.tokensPerSec > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums text-zinc-400">
                              {m.tokensPerSec} tok/s
                            </span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{m.timestamp}</span>
                      </div>

                      {/* Message Bubble / Card */}
                      <div
                        className={`rounded-2xl px-4 py-3.5 border ${
                          isUser
                            ? 'max-w-2xl bg-orange-500/10 border-orange-500/35 text-zinc-100'
                            : m.isError
                            ? 'w-full bg-rose-500/10 border-rose-500/35 text-rose-200'
                            : 'w-full bg-[#111115]/95 border-zinc-800/90 text-zinc-200 backdrop-blur-xs'
                        }`}
                      >
                        {isUser ? (
                          isEditingThis ? (
                            <div className="space-y-2.5 min-w-[260px] sm:min-w-[380px]">
                              <textarea
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                rows={3}
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    commitEditMessage();
                                  } else if (e.key === 'Escape') {
                                    setEditingMsgId(null);
                                  }
                                }}
                                className="w-full bg-[#070709] border border-zinc-700 focus:border-orange-500 rounded-xl p-2.5 text-sm text-zinc-100 focus:outline-none resize-y"
                              />
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditingMsgId(null)}
                                  className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-medium transition-colors"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={commitEditMessage}
                                  disabled={!editingText.trim() || isStreaming}
                                  className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-black text-xs font-semibold transition-colors"
                                >
                                  Save & Resend
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                              {m.content}
                            </p>
                          )
                        ) : m.isError ? (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-start gap-2.5 text-xs leading-relaxed">
                              <AlertTriangle size={15} className="text-rose-400 shrink-0 mt-0.5" />
                              <span>{m.content}</span>
                            </div>
                            <button
                              type="button"
                              onClick={onRegenerate}
                              disabled={isStreaming}
                              className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 text-xs font-semibold flex items-center gap-1.5 self-start sm:self-center shrink-0 transition-colors"
                            >
                              <RefreshCw size={12} />
                              <span>Retry</span>
                            </button>
                          </div>
                        ) : (
                          <MarkdownRenderer content={m.content} messageId={m.id} />
                        )}
                      </div>

                      {/* Per-Message Action Bar */}
                      {!isEditingThis && m.content && (
                        <div className="flex items-center gap-1 mt-1.5 px-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => handleCopyMessage(m.content, m.id)}
                            className="px-2 py-1 rounded-md text-[11px] text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900 flex items-center gap-1 transition-colors"
                            title="Copy message"
                          >
                            {copiedMsgId === m.id ? (
                              <>
                                <Check size={12} className="text-emerald-400" />
                                <span className="text-emerald-400">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy size={12} />
                                <span>Copy</span>
                              </>
                            )}
                          </button>

                          {isUser ? (
                            <button
                              type="button"
                              onClick={() => startEditMessage(m)}
                              disabled={isStreaming}
                              className="px-2 py-1 rounded-md text-[11px] text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900 disabled:opacity-40 flex items-center gap-1 transition-colors"
                              title="Edit and resend"
                            >
                              <Pencil size={12} />
                              <span>Edit</span>
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => handleSpeakMessage(m)}
                                className={`px-2 py-1 rounded-md text-[11px] flex items-center gap-1 transition-colors ${
                                  speakingMsgId === m.id
                                    ? 'text-orange-400 bg-orange-500/10'
                                    : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900'
                                }`}
                                title={speakingMsgId === m.id ? 'Stop speaking' : 'Read aloud'}
                              >
                                {speakingMsgId === m.id ? (
                                  <>
                                    <VolumeX size={12} />
                                    <span>Stop</span>
                                  </>
                                ) : (
                                  <>
                                    <Volume2 size={12} />
                                    <span>Speak</span>
                                  </>
                                )}
                              </button>

                              {isLatestAssist && !m.isError && (
                                <button
                                  type="button"
                                  onClick={onRegenerate}
                                  disabled={isStreaming}
                                  className="px-2 py-1 rounded-md text-[11px] text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900 disabled:opacity-40 flex items-center gap-1 transition-colors"
                                  title="Regenerate response"
                                >
                                  <RefreshCw size={12} />
                                  <span>Regenerate</span>
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Floating Jump-to-Latest Button when Scrolled Up */}
            {!isNearBottom && (
              <div className="absolute bottom-36 left-1/2 -translate-x-1/2 z-30">
                <button
                  type="button"
                  onClick={scrollToLatest}
                  className="px-3.5 py-1.5 rounded-full bg-[#111115] hover:bg-zinc-900 border border-orange-500/40 text-xs font-medium text-orange-400 shadow-xl flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <ArrowDown size={13} />
                  <span>Jump to latest</span>
                </button>
              </div>
            )}

            <div className="px-4 sm:px-6 pb-4 pt-2 bg-[#070709]/95 border-t border-zinc-900 relative z-20">
              {renderComposerCard()}
            </div>
          </>
        )}
      </section>

      {/* Right-Hand Collapsible Memory & Quick Commands Dock (xl+) */}
      <div
        aria-hidden={!showInspector}
        className={`hidden xl:flex shrink-0 overflow-hidden transition-[width,opacity] duration-250 ease-out z-20 ${
          showInspector
            ? 'w-80 opacity-100 visible border-l border-zinc-900'
            : 'w-0 opacity-0 invisible border-l-0 pointer-events-none'
        }`}
      >
        <aside className="w-80 shrink-0 bg-[#0A0A0D] flex flex-col justify-between p-4 overflow-y-auto">
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-xs font-display font-semibold text-zinc-200">
                  Active Memory Bank
                </h3>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  Persisted facts injected into your assistant context.
                </p>
              </div>
              <button
                type="button"
                onClick={onToggleInspector}
                title="Collapse Memory & Commands Sidebar"
                aria-label="Collapse right sidebar"
                className="p-2 rounded-lg border bg-orange-500/15 border-orange-500/40 text-orange-400 hover:bg-orange-500/25 transition-colors shrink-0"
              >
                <PanelRightClose size={15} />
              </button>
            </div>

            {/* Quick Add Memory Form */}
            <form onSubmit={handleQuickAddMemory} className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Key"
                  value={quickMemKey}
                  onChange={(e) => setQuickMemKey(e.target.value)}
                  className="bg-[#070709] border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500"
                />
                <input
                  type="text"
                  placeholder="Value"
                  value={quickMemVal}
                  onChange={(e) => setQuickMemVal(e.target.value)}
                  className="bg-[#070709] border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500"
                />
              </div>
              <button
                type="submit"
                className="w-full py-1.5 px-3 rounded-lg bg-orange-500 hover:bg-orange-400 text-black text-xs font-semibold transition-colors"
              >
                + Store Fact
              </button>
            </form>

            {/* Stored Memory Items */}
            <div className="divide-y divide-zinc-900 border border-zinc-800/90 rounded-xl bg-[#070709]">
              {Object.entries(memory).length === 0 ? (
                <div className="p-4 text-xs text-zinc-500 text-center">
                  No memories stored yet.
                </div>
              ) : (
                Object.entries(memory).map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-start justify-between gap-2 px-3 py-2.5 text-xs"
                  >
                    <div className="flex-1 min-w-0">
                      <div
                        className="font-mono font-medium text-orange-400 break-words"
                        title={k}
                      >
                        {k}
                      </div>
                      <div
                        className="text-zinc-400 mt-0.5 leading-relaxed break-words line-clamp-3"
                        title={v}
                      >
                        {v}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...memory };
                        delete next[k];
                        onUpdateMemory(next);
                      }}
                      className="text-zinc-600 hover:text-rose-400 p-1 -mt-0.5 transition-colors shrink-0"
                      title="Delete memory"
                      aria-label={`Delete ${k}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* 1-Click Instant Commands */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-display font-semibold text-zinc-200">
                  Quick Commands
                </h3>
                <button
                  type="button"
                  onClick={onOpenCapabilities}
                  className="text-[11px] text-zinc-400 hover:text-orange-400 transition-colors"
                >
                  View All
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_SLASH_COMMANDS.slice(0, 6).map((btn) => (
                  <button
                    type="button"
                    key={btn.slash}
                    onClick={() => triggerQuickCommand(btn)}
                    title={btn.description}
                    className="px-2.5 py-2 rounded-lg bg-[#070709] hover:bg-zinc-900 border border-zinc-800/90 hover:border-orange-500/40 text-xs text-zinc-300 text-left truncate transition-colors"
                  >
                    <span className="font-mono text-orange-400">{btn.slash}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom-Right Session Policy Card (mirrors bottom-left Engine Diagnostics) */}
          <div className="pt-4 mt-4 border-t border-zinc-900 shrink-0">
            <div className="p-3 rounded-xl bg-[#070709] border border-zinc-800/90 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-display font-semibold text-zinc-200">
                  Session Policy
                </span>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-500">Routing</span>
                  <span className="font-mono text-zinc-300 tabular-nums">
                    Sticky (3 turns)
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-500">Context Window</span>
                  <span className="font-mono text-zinc-300 tabular-nums">
                    6 turns
                  </span>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
