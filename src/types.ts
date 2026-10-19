export type NavView = 'HOME' | 'CHAT' | 'VISION' | 'MEMORY' | 'SETTINGS';

export type MessageRole = 'user' | 'assist' | 'system' | 'boot';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  model?: string;
  tokensPerSec?: number;
  elapsedMs?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  messages: ChatMessage[];
}

export type MemoryStore = Record<string, string>;

export interface SystemStats {
  cpu: number;
  ram: number;
  clock: string;
  isOnline: boolean;
  ollamaReachable: boolean;
  resolvedModel: string;
  installedModels: string[];
}

export interface JarvisSettings {
  model: string;
  generalModel: string;
  codingModel: string;
  visionModel: string;
  ollamaHost: string;
  temperature: number;
  maxTokens: number;
  keepAliveMinutes: number;
  voiceEnabled: boolean;
  sfxEnabled: boolean;
  handsFreeMode: boolean;
  voicePitch: number;
  voiceRate: number;
  preferredVoice: string;
}

export interface VisionDetection {
  label: string;
  confidence: number;
  description: string;
  status: string;
}
