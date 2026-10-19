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
import { getShort } from './services/attribution';
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

export const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<NavView>('CHAT');
  const [selectedModel, setSelectedModel] = useState<string>('auto');
  const [resolvedModel, setResolvedModel] = useState<string>('qwen2.5:3b');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [showCapabilities, setShowCapabilities] = useState<boolean>(false);
  const [showInspector, setShowInspector] = useState<boolean>(true);
  const [pendingConfirmation, setPendingConfirmation] = useState<'shutdown' | 'restart' | null>(
    null
  );

  // Settings State
  const [settings, setSettings] = useState<JarvisSettings>(() => {
    try {
      const saved = localStorage.getItem('jarvis_settings_v3');
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  // Memory State (clean, zero personal folder/drive info)
  const [memory, setMemory] = useState<MemoryStore>(() => {
    try {
      const saved = localStorage.getItem('jarvis_memory_v3');
      return saved
        ? JSON.parse(saved)
        : {
            assistant: 'J.A.R.V.I.S',
            routing: 'Sticky Auto (qwen2.5:3b / qwen2.5-coder:7b)',
            interface_theme: 'Futuristic Black & Orange'
          };
    } catch {
      return {};
    }
  });

  // Chat Sessions (starts on the centered Claude-style stage with the fade-in/fade-out triangle)
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const saved = localStorage.getItem('jarvis_sessions_v3');
      if (saved) return JSON.parse(saved);
    } catch {
      // fallback
    }
    return [
      {
        id: 'session-main',
        title: 'New Chat',
        createdAt: new Date().toISOString(),
        messages: []
      }
    ];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>('session-main');

  const activeSession =
    sessions.find((s) => s.id === activeSessionId) ||
    sessions[0] || {
      id: 'session-main',
      title: 'New Chat',
      createdAt: new Date().toISOString(),
      messages: []
    };

  // Telemetry & Clock
  const [stats, setStats] = useState<SystemStats>({
    cpu: 8,
    ram: 62,
    clock: new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }),
    isOnline: true,
    ollamaReachable: false,
    resolvedModel: 'qwen2.5:3b',
    installedModels: []
  });

  const routerRef = useRef(new JarvisRouter());
  const abortStreamingRef = useRef(false);

  useEffect(() => {
    sfx.enabled = settings.sfxEnabled;
    localStorage.setItem('jarvis_settings_v3', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('jarvis_memory_v3', JSON.stringify(memory));
  }, [memory]);

  useEffect(() => {
    localStorage.setItem('jarvis_sessions_v3', JSON.stringify(sessions));
  }, [sessions]);

  const checkOllamaHealth = useCallback(async () => {
    const res = await probeLocalOllama(settings.ollamaHost);
    setStats((prev) => ({
      ...prev,
      ollamaReachable: res.reachable,
      installedModels: res.models
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

      setStats((prev) => {
        const cpuJitter = Math.min(32, Math.max(4, Math.round(prev.cpu + (Math.random() - 0.48) * 3)));
        const ramJitter = Math.min(80, Math.max(54, Math.round(prev.ram + (Math.random() - 0.5) * 2)));
        return {
          ...prev,
          clock: timeStr,
          cpu: cpuJitter,
          ram: ramJitter
        };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setStats((prev) => ({
      ...prev,
      resolvedModel
    }));
  }, [resolvedModel]);

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
  }, [activeSessionId, settings.voiceEnabled]);

  const toggleVoice = () => {
    sfx.playClick();
    setSettings((prev) => {
      const next = !prev.voiceEnabled;
      if (!next) SpeechService.stop();
      return { ...prev, voiceEnabled: next };
    });
  };

  const handleSelectView = (view: NavView) => {
    sfx.playClick();
    setCurrentView(view);
  };

  const handleNewChat = () => {
    sfx.playClick();
    SpeechService.stop();
    abortStreamingRef.current = true;
    setIsStreaming(false);

    const newId = `session-${Date.now()}`;
    const newSession: ChatSession = {
      id: newId,
      title: 'New Chat',
      createdAt: new Date().toISOString(),
      messages: []
    };

    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newId);
    setCurrentView('CHAT');
  };

  const handleClearScreen = () => {
    sfx.playClick();
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSessionId ? { ...s, messages: [] } : s))
    );
  };

  const handleClearHistory = () => {
    sfx.playClick();
    localStorage.removeItem('jarvis_sessions_v3');
    const resetId = `session-${Date.now()}`;
    setSessions([
      {
        id: resetId,
        title: 'New Chat',
        createdAt: new Date().toISOString(),
        messages: []
      }
    ]);
    setActiveSessionId(resetId);
  };

  const handleExportChat = () => {
    sfx.playCommandConfirm();
    const currentMsgs = activeSession.messages;
    const header = `# J.A.R.V.I.S Conversation Log\n\n- Date: ${new Date().toLocaleString()}\n- Attribution: ${getShort()}\n- License: Free to use and redistribute with creator attribution retained.\n\n---\n\n`;
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
  };

  const handleStopStreaming = () => {
    sfx.playClick();
    abortStreamingRef.current = true;
    setIsStreaming(false);
    SpeechService.stop();
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isStreaming) return;

    abortStreamingRef.current = false;
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp
    };

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === activeSessionId) {
          const isInitial = s.messages.filter((m) => m.role === 'user').length === 0;
          const newTitle = isInitial
            ? text.length > 32
              ? text.slice(0, 32) + '...'
              : text
            : s.title;
          return {
            ...s,
            title: newTitle,
            messages: [...s.messages, userMsg]
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
      stats.ollamaReachable
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
        model: 'command'
      };

      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId ? { ...s, messages: [...s.messages, assistMsg] } : s
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

    const resolved = routerRef.current.resolve(text, selectedModel, settings);
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
        s.id === activeSessionId
          ? { ...s, messages: [...s.messages, initialAssistMsg] }
          : s
      )
    );

    setIsStreaming(true);

    try {
      let finalContent = '';
      const stream = streamJarvisResponse(
        text,
        resolved,
        memory,
        activeSession.messages,
        settings
      );

      for await (const chunk of stream) {
        if (abortStreamingRef.current) break;
        finalContent = chunk;

        setSessions((prev) =>
          prev.map((s) => {
            if (s.id === activeSessionId) {
              const updated = s.messages.map((m) =>
                m.id === assistMsgId ? { ...m, content: chunk } : m
              );
              return { ...s, messages: updated };
            }
            return s;
          })
        );
      }

      if (settings.voiceEnabled && finalContent && !abortStreamingRef.current) {
        SpeechService.speak(finalContent, {
          voiceName: settings.preferredVoice,
          rate: settings.voiceRate,
          pitch: settings.voicePitch
        });
      }
    } catch (err) {
      console.error('Inference error:', err);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleRegenerate = () => {
    const userMsgs = activeSession.messages.filter((m) => m.role === 'user');
    if (userMsgs.length === 0 || isStreaming) return;
    const lastUserMsg = userMsgs[userMsgs.length - 1];

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === activeSession.id) {
          let msgs = [...s.messages];
          if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assist') {
            msgs.pop();
          }
          if (msgs.length > 0 && msgs[msgs.length - 1].id === lastUserMsg.id) {
            msgs.pop();
          }
          return { ...s, messages: msgs };
        }
        return s;
      })
    );

    handleSendMessage(lastUserMsg.content);
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
      />

      {/* Main Workspace Frame */}
      <div className="flex-1 flex min-h-0">
        <Sidebar
          currentView={currentView}
          onSelectView={handleSelectView}
          onNewChat={handleNewChat}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={setActiveSessionId}
          stats={stats}
          onRefreshOllama={checkOllamaHealth}
          showInspector={showInspector}
          onToggleInspector={() => {
            sfx.playClick();
            setShowInspector((prev) => !prev);
          }}
        />

        <main className="flex-1 flex flex-col min-w-0">
          {currentView === 'CHAT' && (
            <ChatView
              messages={activeSession.messages}
              isStreaming={isStreaming}
              onSendMessage={handleSendMessage}
              onStopStreaming={handleStopStreaming}
              onRegenerate={handleRegenerate}
              onExportChat={handleExportChat}
              onClearScreen={handleClearScreen}
              onOpenVision={() => handleSelectView('VISION')}
              onOpenCapabilities={() => setShowCapabilities(true)}
              selectedModel={selectedModel}
              onSelectModel={setSelectedModel}
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
              onQuickAction={(cmd) => {
                setCurrentView('CHAT');
                handleSendMessage(cmd);
              }}
              onOpenCapabilities={() => setShowCapabilities(true)}
              onRefreshOllama={checkOllamaHealth}
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
