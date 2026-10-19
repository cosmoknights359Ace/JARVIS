import React, { useState, useRef, useEffect } from 'react';
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
  Command
} from 'lucide-react';
import { ChatMessage, JarvisSettings, MemoryStore, SystemStats } from '../types';
import { QUICK_SLASH_COMMANDS, QuickSlashCommand } from '../services/jarvisBrain';
import { DictationService } from '../services/speech';
import { sfx } from '../services/soundEffects';
import { ArcReactor } from './ArcReactor';

interface ChatViewProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
  onStopStreaming: () => void;
  onRegenerate: () => void;
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
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  isStreaming,
  onSendMessage,
  onStopStreaming,
  onRegenerate,
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
  showInspector
}) => {
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [quickMemKey, setQuickMemKey] = useState('');
  const [quickMemVal, setQuickMemVal] = useState('');

  // Input history buffer (Up/Down arrow key support)
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const userHistoryRef = useRef<string[]>([]);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  // Slash command filtering when input starts with "/"
  const isSlashActive = inputText.startsWith('/');
  const filteredSlashCommands = isSlashActive
    ? QUICK_SLASH_COMMANDS.filter(
        (c) =>
          c.slash.toLowerCase().includes(inputText.toLowerCase()) ||
          c.label.toLowerCase().includes(inputText.slice(1).toLowerCase())
      )
    : [];

  const triggerQuickCommand = (cmd: QuickSlashCommand) => {
    sfx.playClick();
    if (cmd.needsArg && cmd.placeholder) {
      setInputText(cmd.placeholder);
      inputRef.current?.focus();
    } else {
      setInputText('');
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
    onSendMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isSlashActive && filteredSlashCommands.length === 1) {
        triggerQuickCommand(filteredSlashCommands[0]);
        return;
      }
      handleSend();
    } else if (e.key === 'ArrowUp') {
      if (userHistoryRef.current.length === 0) return;
      e.preventDefault();
      const nextIdx =
        historyIndex === -1
          ? userHistoryRef.current.length - 1
          : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIdx);
      setInputText(userHistoryRef.current[nextIdx]);
    } else if (e.key === 'ArrowDown') {
      if (userHistoryRef.current.length === 0 || historyIndex === -1) return;
      e.preventDefault();
      const nextIdx = historyIndex + 1;
      if (nextIdx >= userHistoryRef.current.length) {
        setHistoryIndex(-1);
        setInputText('');
      } else {
        setHistoryIndex(nextIdx);
        setInputText(userHistoryRef.current[nextIdx]);
      }
    } else if (e.key === 'Escape') {
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

  const copyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCodeId(id);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  const formatInlineHtml = (rawLine: string): string => {
    const escaped = rawLine
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    return escaped
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-orange-400 underline hover:text-orange-300 font-medium">$1</a>'
      )
      .replace(
        /\*\*([^*]+)\*\*/g,
        '<strong class="font-semibold text-white">$1</strong>'
      )
      .replace(
        /`([^`]+)`/g,
        '<code class="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 font-mono text-xs text-orange-400">$1</code>'
      );
  };

  const renderMessageContent = (text: string, msgId: string) => {
    if (!text) {
      return (
        <div className="flex items-center gap-2 text-xs text-orange-400 font-mono py-1">
          <span className="inline-block w-2 h-2 rounded-full bg-orange-500 animate-ping" />
          <span>Synthesizing response...</span>
        </div>
      );
    }

    // If a code fence is currently streaming and unclosed, close it virtually so live syntax box renders cleanly
    const fenceCount = (text.match(/```/g) || []).length;
    const normalizedText = fenceCount % 2 === 1 ? `${text}\n\`\`\`` : text;
    const parts = normalizedText.split(/(```[\s\S]*?```)/g);

    return parts.map((part, idx) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const rawContent = part.slice(3, -3);
        const firstLineEnd = rawContent.indexOf('\n');
        const lang = firstLineEnd !== -1 ? rawContent.slice(0, firstLineEnd).trim() : '';
        const code = firstLineEnd !== -1 ? rawContent.slice(firstLineEnd + 1) : rawContent;
        const codeBlockId = `${msgId}-${idx}`;

        return (
          <div
            key={idx}
            className="my-3 rounded-xl overflow-hidden border border-zinc-800 bg-[#070709]"
          >
            <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/90 border-b border-zinc-800 text-xs text-zinc-400 font-mono">
              <span className="text-orange-400">{lang || 'code'}</span>
              <button
                onClick={() => copyCode(code, codeBlockId)}
                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-orange-400 transition-colors"
                title="Copy code snippet"
              >
                {copiedCodeId === codeBlockId ? (
                  <>
                    <Check size={13} className="text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy size={13} />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-4 overflow-x-auto text-xs font-mono text-zinc-200 leading-relaxed">
              <code>{code}</code>
            </pre>
          </div>
        );
      }

      const lines = part.split('\n');
      return (
        <div key={idx} className="space-y-1.5">
          {lines.map((line, lIdx) => {
            if (!line.trim()) return <div key={lIdx} className="h-1" />;

            if (line.startsWith('### ')) {
              return (
                <h3
                  key={lIdx}
                  className="text-sm font-display font-semibold text-orange-400 pt-2"
                >
                  {line.slice(4)}
                </h3>
              );
            }

            if (line.startsWith('## ')) {
              return (
                <h2
                  key={lIdx}
                  className="text-base font-display font-bold text-orange-400 pt-2"
                >
                  {line.slice(3)}
                </h2>
              );
            }

            return (
              <p
                key={lIdx}
                className="text-sm text-zinc-200 leading-relaxed"
                dangerouslySetInnerHTML={{
                  __html: formatInlineHtml(line)
                }}
              />
            );
          })}
        </div>
      );
    });
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

  // Claude-Style Futuristic Composer Box (shared between centered empty state and bottom docked state)
  const renderComposerCard = () => (
    <div className="w-full max-w-3xl mx-auto space-y-2.5 relative z-20">
      {/* Floating Slash-Command Autocomplete Menu when user types "/" */}
      {isSlashActive && filteredSlashCommands.length > 0 && (
        <div className="w-full rounded-xl bg-[#0F0F13] border border-orange-500/40 shadow-2xl overflow-hidden divide-y divide-zinc-800/80 mb-2">
          <div className="px-3.5 py-2 bg-zinc-900/80 text-[11px] font-mono text-orange-400 flex items-center justify-between">
            <span>QUICK SLASH COMMANDS</span>
            <span>Click or press Enter</span>
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-zinc-900">
            {filteredSlashCommands.map((cmd) => (
              <button
                key={cmd.slash}
                onClick={() => triggerQuickCommand(cmd)}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-orange-500/10 text-left transition-colors"
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
                  Run ↵
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Claude-style Elevated Composer Surface */}
      <div className="rounded-2xl bg-[#111115] border border-zinc-800/90 focus-within:border-orange-500/70 shadow-2xl p-3 transition-colors">
        {/* Input Row */}
        <div className="flex items-center gap-2 px-1 py-1">
          <Terminal size={16} className="text-orange-500 shrink-0" />
          <input
            id="chatInput"
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message J.A.R.V.I.S or type / for instant commands..."
            autoComplete="off"
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
        </div>

        {/* Bottom Composer Control Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 mt-2 border-t border-zinc-800/80">
          {/* Left Controls: Attach + Quick Slash Trigger + Hands-Free */}
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <button
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
                    onClick={() => {
                      setShowAttachMenu(false);
                      onClearScreen();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-zinc-200 hover:bg-zinc-800 transition-colors text-left"
                  >
                    <Trash2 size={14} className="text-orange-500" />
                    <span>Reset Screen</span>
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={() => {
                setInputText('/');
                inputRef.current?.focus();
              }}
              className="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-mono text-orange-400 flex items-center gap-1 transition-colors"
              title="Open Slash Command Menu"
            >
              <Command size={12} />
              <span>/cmds</span>
            </button>

            <button
              onClick={() =>
                onUpdateSettings({
                  ...settings,
                  handsFreeMode: !settings.handsFreeMode
                })
              }
              className={`px-2.5 py-1 rounded-lg border text-xs flex items-center gap-1.5 transition-colors ${
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
          </div>

          {/* Right Controls: Model Route + Mic + Send/Stop */}
          <div className="flex items-center gap-2">
            <select
              value={selectedModel}
              onChange={(e) => onSelectModel(e.target.value)}
              aria-label="Select AI Model"
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-zinc-300 focus:outline-none focus:border-orange-500 shrink-0"
            >
              {modelChoices.map((m) => (
                <option key={m} value={m}>
                  {m === 'auto' ? `auto (${stats.resolvedModel})` : m}
                </option>
              ))}
            </select>

            <button
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
                id="stopBtn"
                onClick={onStopStreaming}
                title="Stop generation"
                className="px-3.5 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-400 text-black font-semibold text-xs flex items-center gap-1.5 transition-colors shrink-0"
              >
                <Square size={12} className="fill-current" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                id="sendBtn"
                onClick={handleSend}
                title="Send message (Enter)"
                className="px-3.5 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-black font-semibold text-xs flex items-center gap-1.5 transition-colors shrink-0"
              >
                <Send size={12} />
                <span>Send</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 1-Click Easy Command Action Strip */}
      <div className="flex items-center gap-1.5 overflow-x-auto py-1 px-1">
        {QUICK_SLASH_COMMANDS.slice(0, 8).map((cmd) => (
          <button
            key={cmd.slash}
            onClick={() => triggerQuickCommand(cmd)}
            className="px-2.5 py-1 rounded-lg bg-[#111115] hover:bg-orange-500/15 border border-zinc-800/90 hover:border-orange-500/40 text-xs font-mono text-zinc-300 hover:text-orange-400 transition-colors whitespace-nowrap shrink-0"
            title={cmd.description}
          >
            {cmd.slash}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex min-h-0 bg-[#070709] relative">
      {/* Primary Stage */}
      <section className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
        {/* Ambient Center Fade-In/Fade-Out Triangle when messages exist */}
        {messages.length > 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            <ArcReactor size={240} pulsing={true} ambient={true} />
          </div>
        )}

        {messages.length === 0 ? (
          /* Claude AI-Style Centered Futuristic Stage when Session is Fresh */
          <div className="flex-1 overflow-y-auto px-6 py-8 flex flex-col items-center justify-center relative z-10">
            <div className="w-full max-w-3xl mx-auto flex flex-col items-center text-center space-y-6">
              {/* Centerpiece Fade-In / Fade-Out Orange Triangle */}
              <ArcReactor size={156} pulsing={true} />

              <div className="space-y-1.5">
                <h1 className="text-2xl sm:text-3xl font-display font-bold text-zinc-100 tracking-tight">
                  At your service, Sir.
                </h1>
                <p className="text-xs sm:text-sm text-zinc-400 max-w-lg mx-auto">
                  Active route: <code className="font-mono text-orange-400">{stats.resolvedModel}</code> · Click any command below or type <code className="font-mono text-orange-400">/</code> for instant actions.
                </p>
              </div>

              {/* Centered Claude-Style Composer */}
              {renderComposerCard()}
            </div>
          </div>
        ) : (
          /* Active Conversation Stream + Bottom Composer */
          <>
            <div
              id="chatScroll"
              ref={chatScrollRef}
              className="flex-1 overflow-y-auto px-6 py-6 space-y-6 relative z-10"
            >
              <div className="max-w-3xl mx-auto space-y-6">
                {messages.map((m) => {
                  const isUser = m.role === 'user';
                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                    >
                      <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1.5 px-1">
                        <span className="font-semibold text-zinc-300">
                          {isUser ? 'You' : 'J.A.R.V.I.S'}
                        </span>
                        {!isUser && m.model && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-orange-400">{m.model}</span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{m.timestamp}</span>
                      </div>

                      <div
                        className={`max-w-2xl rounded-2xl px-4 py-3.5 border ${
                          isUser
                            ? 'bg-orange-500/10 border-orange-500/35 text-zinc-100'
                            : 'bg-[#111115]/95 border-zinc-800/90 text-zinc-200 w-full backdrop-blur-xs'
                        }`}
                      >
                        {isUser ? (
                          <p className="text-sm leading-relaxed">{m.content}</p>
                        ) : (
                          renderMessageContent(m.content, m.id)
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="px-6 pb-4 pt-2 bg-[#070709]/95 border-t border-zinc-900 relative z-20">
              {renderComposerCard()}
            </div>
          </>
        )}
      </section>

      {/* Right-Hand Command & Memory Dock */}
      {showInspector && (
        <aside className="hidden xl:flex w-80 shrink-0 bg-[#0A0A0D] border-l border-zinc-900 flex-col justify-between p-4 overflow-y-auto z-20">
          <div className="space-y-6">
            <div>
              <h3 className="text-xs font-display font-semibold text-zinc-200">
                Active Memory Bank
              </h3>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                Persisted facts injected into your assistant context.
              </p>
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
                className="w-full py-1.5 px-3 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/30 text-orange-400 text-xs font-semibold transition-colors"
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
                    className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-medium text-orange-400 truncate">
                        {k}
                      </div>
                      <div className="text-zinc-400 truncate">{v}</div>
                    </div>
                    <button
                      onClick={() => {
                        const next = { ...memory };
                        delete next[k];
                        onUpdateMemory(next);
                      }}
                      className="text-zinc-600 hover:text-rose-400 p-1 transition-colors shrink-0"
                      title="Delete memory"
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
                  1-Click Commands
                </h3>
                <button
                  onClick={onOpenCapabilities}
                  className="text-[11px] text-orange-400 hover:underline"
                >
                  View All
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_SLASH_COMMANDS.slice(0, 6).map((btn) => (
                  <button
                    key={btn.slash}
                    onClick={() => triggerQuickCommand(btn)}
                    className="px-2.5 py-2 rounded-lg bg-[#070709] hover:bg-zinc-900 border border-zinc-800/90 hover:border-orange-500/40 text-xs text-zinc-300 text-left truncate transition-colors"
                  >
                    <span className="font-mono text-orange-400 mr-1">{btn.slash}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-zinc-900 text-[11px] text-zinc-500 space-y-1">
            <div>Routing: Sticky (3 turns)</div>
            <div>Context Window: 6 turns</div>
          </div>
        </aside>
      )}
    </div>
  );
};
