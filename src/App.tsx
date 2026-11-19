import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  NavView,
  ChatMessage,
  ChatSession,
  MemoryStore,
  JarvisSettings,
  SystemStats
} from './types';
import { Topbar } from './components/Topbar';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { HomeView } from './components/HomeView';
import { XfillView } from './components/XfillView';
import { SlidesView } from './components/SlidesView';
import { VisionView } from './components/VisionView';
import { MemoryView } from './components/MemoryView';
import { SettingsView } from './components/SettingsView';
import { CapabilitiesModal } from './components/CapabilitiesModal';
import {
  JarvisRouter,
  handleCommand,
  streamJarvisResponse,
  probeLocalOllama
} from './services/jarvisBrain';
import { SpeechService } from './services/speech';
import { getShort, getSeal, verifyAttributionReport } from './services/attribution';
import { sfx } from './services/soundEffects';

const DEFAULT_SETTINGS: JarvisSettings = {
  model: 'auto',
  generalModel: 'qwen2.5:3b',
  codingModel: 'qwen2.5-coder:7b',
  visionModel: 'llama3.2-vision:latest',
  ollamaHost: 'http://localhost:11434',
  temperature: 0.7,
  maxTokens: 1024,
  keepAliveMinutes: 30,
  voiceEnabled: true,
  sfxEnabled: true,
  handsFreeMode: false,
  voicePitch: 1.0,
  voiceRate: 1.0,
  preferredVoice: ''
};

function createFreshSession(): ChatSession {
  const now = new Date().toISOString();
  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: 'New Chat',
    createdAt: now,
    updatedAt: now,
    messages: []
  };
}

export const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<NavView>('CHAT');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [showCapabilities, setShowCapabilities] = useState<boolean>(false);
  const [showInspector, setShowInspector] = useState<boolean>(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<'shutdown' | 'restart' | null>(
    null
  );

  // Settings State (persisted, includes active model selection)
  const [settings, setSettings] = useState<JarvisSettings>(() => {
    try {
      const saved = localStorage.getItem('jarvis_settings_v3');
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [resolvedModel, setResolvedModel] = useState<string>(() =>
    settings.model === 'auto' ? settings.generalModel : settings.model
  );

  // Memory State
  const [memory, setMemory] = useState<MemoryStore>(() => {
    try {
      const saved = localStorage.getItem('jarvis_memory_v3');
      return saved
        ? JSON.parse(saved)
        : {
            assistant: 'J.A.R.V.I.S',
            routing: 'Sticky Auto (qwen2.5:3b / qwen2.5-coder:7b)',
            interface_theme: 'Obsidian & Orange'
          };
    } catch {
      return {};
    }
  });

  // Chat Sessions State
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const saved = localStorage.getItem('jarvis_sessions_v3');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // fallback
    }
    return [createFreshSession()];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => sessions[0].id);

  const activeSession =
    sessions.find((s) => s.id === activeSessionId) || sessions[0];

  const clientAttributionOk = verifyAttributionReport().ok;

  // Real Engine Diagnostics & Clock (zero simulated CPU/RAM jitter)
  const [stats, setStats] = useState<SystemStats>({
    clock: new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }),
    isOnline: true,
    activeProvider: 'offline',
    ollamaReachable: false,
    geminiAvailable: false,
    probeLatencyMs: null,
    lastTtftMs: null,
    lastElapsedMs: null,
    lastTokensPerSec: null,
    serverUptimeSec: null,
    resolvedModel: settings.model === 'auto' ? settings.generalModel : settings.model,
    installedModels: [],
    attributionVerified: clientAttributionOk,
    attributionSeal: getSeal(),
    licenseFileIntact: true
  });

  const routerRef = useRef(new JarvisRouter());
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    sfx.enabled = settings.sfxEnabled;
    localStorage.setItem('jarvis_settings_v3', JSON.stringify(settings));
  }, [settings]);

  // Keep resolvedModel synced whenever user updates model preference or default general model
  useEffect(() => {
    if (settings.model !== 'auto') {
      setResolvedModel(settings.model);
    } else {
      setResolvedModel(settings.generalModel);
    }
  }, [settings.model, settings.generalModel]);

  useEffect(() => {
    localStorage.setItem('jarvis_memory_v3', JSON.stringify(memory));
  }, [memory]);

  useEffect(() => {
    localStorage.setItem('jarvis_sessions_v3', JSON.stringify(sessions));
  }, [sessions]);

  const checkOllamaHealth = useCallback(async () => {
    const res = await probeLocalOllama(settings.ollamaHost);
    const localOk = verifyAttributionReport().ok;
    setStats((prev) => ({
      ...prev,
      ollamaReachable: res.reachable,
      geminiAvailable: res.geminiAvailable,
      activeProvider: res.activeProvider,
      probeLatencyMs: res.probeLatencyMs,
      serverUptimeSec: res.serverUptimeSec,
      installedModels: res.models,
      attributionVerified: localOk && res.attributionVerified,
      attributionSeal: res.attributionSeal || getSeal(),
      licenseFileIntact: res.licenseFileIntact
    }));
  }, [settings.ollamaHost]);

  useEffect(() => {
    checkOllamaHealth();
    const interval = setInterval(checkOllamaHealth, 15000);
    return () => clearInterval(interval);
  }, [checkOllamaHealth]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      const timeStr = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;

      setStats((prev) => ({
        ...prev,
        clock: timeStr,
        serverUptimeSec: prev.serverUptimeSec !== null ? prev.serverUptimeSec + 1 : null
      }));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setStats((prev) => ({
      ...prev,
      resolvedModel
    }));
  }, [resolvedModel]);

  const abortActiveStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const toggleVoice = useCallback(() => {
    sfx.playClick();
    setSettings((prev) => {
      const next = !prev.voiceEnabled;
      if (!next) SpeechService.stop();
      return { ...prev, voiceEnabled: next };
    });
  }, []);

  const handleSelectModel = useCallback((model: string) => {
    setSettings((prev) => ({ ...prev, model }));
  }, []);

  const handleSelectView = (view: NavView) => {
    sfx.playClick();
    setCurrentView(view);
  };

  const handleNewChat = () => {
    sfx.playClick();
    SpeechService.stop();
    abortActiveStream();

    const newSession = createFreshSession();
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setCurrentView('CHAT');
  };

  const handleRenameSession = (id: string, newTitle: string) => {
    sfx.playClick();
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, title: newTitle, updatedAt: new Date().toISOString() } : s
      )
    );
  };

  const handleDeleteSession = (id: string) => {
    sfx.playClick();
    if (id === activeSessionId) {
      SpeechService.stop();
      abortActiveStream();
    }

    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== id);
      if (remaining.length === 0) {
        const fresh = createFreshSession();
        setActiveSessionId(fresh.id);
        return [fresh];
      }
      if (id === activeSessionId) {
        setActiveSessionId(remaining[0].id);
      }
      return remaining;
    });
  };

  const handleClearScreen = useCallback(() => {
    sfx.playClick();
    abortActiveStream();
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? { ...s, messages: [], updatedAt: new Date().toISOString() }
          : s
      )
    );
  }, [activeSessionId, abortActiveStream]);

  const handleClearHistory = () => {
    sfx.playClick();
    abortActiveStream();
    localStorage.removeItem('jarvis_sessions_v3');
    const fresh = createFreshSession();
    setSessions([fresh]);
    setActiveSessionId(fresh.id);
  };

  const handleExportChat = useCallback(() => {
    sfx.playCommandConfirm();
    const currentMsgs = activeSession.messages;
    const header = `# J.A.R.V.I.S Conversation Log — ${activeSession.title}\n\n- Date: ${new Date().toLocaleString()}\n- Attribution: ${getShort()}\n- License: Free to use and redistribute with creator attribution retained.\n\n---\n\n`;
    const body = currentMsgs
      .map(
        (m) =>
          `### ${m.role === 'user' ? 'YOU' : `JARVIS (${m.model || 'model'})`} · ${m.timestamp}\n\n${m.content}\n`
      )
      .join('\n---\n\n');

    const blob = new Blob([header + body], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jarvis_chat_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeSession]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'l') {
          e.preventDefault();
          handleClearScreen();
        } else if (k === 'e') {
          e.preventDefault();
          handleExportChat();
        } else if (k === 'm') {
          e.preventDefault();
          toggleVoice();
        } else if (k === 'k') {
          e.preventDefault();
          setShowCapabilities((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClearScreen, handleExportChat, toggleVoice]);

  const handleStopStreaming = () => {
    sfx.playClick();
    abortActiveStream();
    SpeechService.stop();
  };

  const executePromptOnSession = async (
    targetSessionId: string,
    text: string,
    priorMessages: ChatMessage[]
  ) => {
    const nowIso = new Date().toISOString();
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp
    };

    const withUserMessages = [...priorMessages, userMsg];

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === targetSessionId) {
          const isInitial = priorMessages.filter((m) => m.role === 'user').length === 0;
          const cleanSingleLine = text.replace(/\s+/g, ' ').trim();
          const newTitle =
            isInitial && s.title === 'New Chat'
              ? cleanSingleLine.length > 36
                ? cleanSingleLine.slice(0, 36) + '...'
                : cleanSingleLine
              : s.title;
          return {
            ...s,
            title: newTitle,
            updatedAt: nowIso,
            messages: withUserMessages
          };
        }
        return s;
      })
    );

    const cmdResult = handleCommand(
      text,
      memory,
      (newMem) => setMemory(newMem),
      pendingConfirmation,
      setPendingConfirmation,
      stats
    );

    if (cmdResult.handled) {
      sfx.playCommandConfirm();
      if (cmdResult.type === 'clear') {
        handleClearScreen();
        return;
      }
      if (cmdResult.type === 'export') {
        handleExportChat();
        return;
      }

      const assistMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assist',
        content: cmdResult.text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        model: 'command',
        provider: 'command'
      };

      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetSessionId
            ? { ...s, updatedAt: new Date().toISOString(), messages: [...s.messages, assistMsg] }
            : s
        )
      );

      if (settings.voiceEnabled && cmdResult.speakText) {
        SpeechService.speak(cmdResult.speakText, {
          voiceName: settings.preferredVoice,
          rate: settings.voiceRate,
          pitch: settings.voicePitch
        });
      }
      return;
    }

    const resolved = routerRef.current.resolve(text, settings.model, settings);
    setResolvedModel(resolved);

    const assistMsgId = `a-${Date.now()}`;
    const initialAssistMsg: ChatMessage = {
      id: assistMsgId,
      role: 'assist',
      content: '',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      model: resolved
    };

    setSessions((prev) =>
      prev.map((s) =>
        s.id === targetSessionId
          ? {
              ...s,
              updatedAt: new Date().toISOString(),
              messages: [...withUserMessages, initialAssistMsg]
            }
          : s
      )
    );

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsStreaming(true);

    try {
      let finalContent = '';
      let hadError = false;

      const stream = streamJarvisResponse(
        text,
        resolved,
        memory,
        priorMessages,
        settings,
        controller.signal
      );

      for await (const evt of stream) {
        if (controller.signal.aborted) break;

        if (evt.type === 'meta') {
          setStats((prev) => ({
            ...prev,
            activeProvider: evt.provider,
            lastTtftMs: evt.ttftMs
          }));
          setSessions((prev) =>
            prev.map((s) =>
              s.id === targetSessionId
                ? {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === assistMsgId
                        ? { ...m, model: evt.model, provider: evt.provider, ttftMs: evt.ttftMs }
                        : m
                    )
                  }
                : s
            )
          );
        } else if (evt.type === 'text') {
          finalContent = evt.content;
          setSessions((prev) =>
            prev.map((s) =>
              s.id === targetSessionId
                ? {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === assistMsgId ? { ...m, content: evt.content } : m
                    )
                  }
                : s
            )
          );
        } else if (evt.type === 'stats') {
          setStats((prev) => ({
            ...prev,
            activeProvider: evt.provider,
            lastTtftMs: evt.ttftMs,
            lastElapsedMs: evt.elapsedMs,
            lastTokensPerSec: evt.tokensPerSec
          }));
          setSessions((prev) =>
            prev.map((s) =>
              s.id === targetSessionId
                ? {
                    ...s,
                    updatedAt: new Date().toISOString(),
                    messages: s.messages.map((m) =>
                      m.id === assistMsgId
                        ? {
                            ...m,
                            model: evt.model,
                            provider: evt.provider,
                            ttftMs: evt.ttftMs,
                            elapsedMs: evt.elapsedMs,
                            tokensPerSec: evt.tokensPerSec
                          }
                        : m
                    )
                  }
                : s
            )
          );
        } else if (evt.type === 'error') {
          hadError = true;
          setSessions((prev) =>
            prev.map((s) =>
              s.id === targetSessionId
                ? {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === assistMsgId
                        ? { ...m, content: evt.message, isError: true }
                        : m
                    )
                  }
                : s
            )
          );
        }
      }

      if (
        settings.voiceEnabled &&
        finalContent &&
        !hadError &&
        !controller.signal.aborted
      ) {
        SpeechService.speak(finalContent, {
          voiceName: settings.preferredVoice,
          rate: settings.voiceRate,
          pitch: settings.voicePitch
        });
      }
    } catch (err) {
      console.error('Inference error:', err);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsStreaming(false);
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isStreaming) return;
    await executePromptOnSession(activeSession.id, text, activeSession.messages);
  };

  const handleRegenerate = async () => {
    if (isStreaming) return;
    const msgs = activeSession.messages;
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx === -1) return;

    const lastUserContent = msgs[lastUserIdx].content;
    const priorBeforeLastUser = msgs.slice(0, lastUserIdx);
    await executePromptOnSession(activeSession.id, lastUserContent, priorBeforeLastUser);
  };

  const handleEditMessage = async (messageId: string, newText: string) => {
    if (isStreaming || !newText.trim()) return;
    const idx = activeSession.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;

    const priorBeforeEdited = activeSession.messages.slice(0, idx);
    await executePromptOnSession(activeSession.id, newText.trim(), priorBeforeEdited);
  };

  return (
    <div className="flex flex-col h-full bg-[#070709] text-[#F4F4F6] font-sans">
      {/* 3-Zone Top Bar */}
      <Topbar
        currentView={currentView}
        onSelectView={handleSelectView}
        onOpenCapabilities={() => {
          sfx.playClick();
          setShowCapabilities(true);
        }}
        onOpenMobileDrawer={() => {
          sfx.playClick();
          setMobileDrawerOpen(true);
        }}
      />

      {/* Tamper-Evident Copyright Integrity Notice (only shown if modified) */}
      {!stats.attributionVerified && (
        <div
          role="alert"
          className="px-4 py-2 bg-rose-500/15 border-b border-rose-500/40 text-xs text-rose-200 flex items-center justify-between gap-4 shrink-0"
        >
          <span>
            <strong>Copyright Integrity Notice:</strong> Creator attribution or LICENSE/NOTICE metadata for{' '}
            <code className="font-mono text-rose-100">J.A.R.V.I.S (c) 2026 cosmoknight</code> appears modified. Retaining original creator credit is required by the license.
          </span>
          <span className="font-mono text-[11px] text-rose-300 shrink-0">
            Seal mismatch
          </span>
        </div>
      )}

      {/* Main Workspace Frame */}
      <div className="flex-1 flex min-h-0">
        <Sidebar
          currentView={currentView}
          onSelectView={handleSelectView}
          onNewChat={handleNewChat}
          sessions={sessions}
          activeSessionId={activeSession.id}
          onSelectSession={setActiveSessionId}
          onRenameSession={handleRenameSession}
          onDeleteSession={handleDeleteSession}
          stats={stats}
          onRefreshOllama={checkOllamaHealth}
          showInspector={showInspector}
          onToggleInspector={() => {
            sfx.playClick();
            setShowInspector((prev) => !prev);
          }}
          mobileOpen={mobileDrawerOpen}
          onCloseMobile={() => setMobileDrawerOpen(false)}
        />

        <main className="flex-1 flex flex-col min-w-0">
          {currentView === 'CHAT' && (
            <ChatView
              messages={activeSession.messages}
              isStreaming={isStreaming}
              onSendMessage={handleSendMessage}
              onStopStreaming={handleStopStreaming}
              onRegenerate={handleRegenerate}
              onEditMessage={handleEditMessage}
              onExportChat={handleExportChat}
              onClearScreen={handleClearScreen}
              onOpenVision={() => handleSelectView('VISION')}
              onOpenCapabilities={() => setShowCapabilities(true)}
              selectedModel={settings.model}
              onSelectModel={handleSelectModel}
              settings={settings}
              onUpdateSettings={setSettings}
              memory={memory}
              onUpdateMemory={setMemory}
              stats={stats}
              showInspector={showInspector}
            />
          )}

          {currentView === 'HOME' && (
            <HomeView
              onSelectView={handleSelectView}
              stats={stats}
              memory={memory}
              settings={settings}
              sessionCount={sessions.length}
              onQuickAction={(cmd) => {
                setCurrentView('CHAT');
                handleSendMessage(cmd);
              }}
              onOpenCapabilities={() => setShowCapabilities(true)}
              onRefreshOllama={checkOllamaHealth}
            />
          )}

          {currentView === 'XFILL' && (
            <XfillView
              settings={settings}
              memory={memory}
              onUpdateMemory={setMemory}
              stats={stats}
            />
          )}

          {currentView === 'SLIDES' && (
            <SlidesView
              settings={settings}
              memory={memory}
              stats={stats}
            />
          )}

          {currentView === 'VISION' && (
            <VisionView
              settings={settings}
              onSendToChat={(query) => {
                setCurrentView('CHAT');
                handleSendMessage(query);
              }}
            />
          )}

          {currentView === 'MEMORY' && (
            <MemoryView
              memory={memory}
              onUpdateMemory={setMemory}
              onClearMemory={() => setMemory({})}
            />
          )}

          {currentView === 'SETTINGS' && (
            <SettingsView
              settings={settings}
              onUpdateSettings={setSettings}
              onClearHistory={handleClearHistory}
              onExportChat={handleExportChat}
              stats={stats}
              onRefreshOllama={checkOllamaHealth}
            />
          )}
        </main>
      </div>

      {/* Interactive Command & Capability Guide Modal */}
      <CapabilitiesModal
        isOpen={showCapabilities}
        onClose={() => setShowCapabilities(false)}
        onRunCommand={(cmd) => {
          setCurrentView('CHAT');
          handleSendMessage(cmd);
        }}
      />
    </div>
  );
};
