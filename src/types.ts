export type NavView = 'HOME' | 'CHAT' | 'XFILL' | 'VISION' | 'MEMORY' | 'SETTINGS';

export type MessageRole = 'user' | 'assist' | 'system' | 'boot';

export type EngineProvider = 'ollama' | 'gemini' | 'offline';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  model?: string;
  provider?: 'ollama' | 'gemini' | 'command';
  ttftMs?: number;
  tokensPerSec?: number;
  elapsedMs?: number;
  isError?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt?: string;
  messages: ChatMessage[];
}

export type MemoryStore = Record<string, string>;

export interface SystemStats {
  clock: string;
  isOnline: boolean;
  activeProvider: EngineProvider;
  ollamaReachable: boolean;
  geminiAvailable: boolean;
  probeLatencyMs: number | null;
  lastTtftMs: number | null;
  lastElapsedMs: number | null;
  lastTokensPerSec: number | null;
  serverUptimeSec: number | null;
  resolvedModel: string;
  installedModels: string[];
  attributionVerified: boolean;
  attributionSeal: string;
  licenseFileIntact: boolean;
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

export type XfillFileType = 'docx' | 'xlsx' | 'pptx';
export type XfillSlotKind = 'placeholder' | 'question' | 'blank_field' | 'table_cell';
export type XfillSource = 'memory' | 'context' | 'knowledge' | 'missing' | 'user' | 'pending';
export type XfillConfidence = 'high' | 'medium' | 'needs_input' | 'pending';

export interface XfillSlot {
  id: string;
  location: string;
  kind: XfillSlotKind;
  prompt: string;
  originalText: string;
  context: string;
  value: string;
  source: XfillSource;
  confidence: XfillConfidence;
  reasoning?: string;
  editedByUser?: boolean;
}

export interface XfillDocument {
  docId: string;
  fileName: string;
  fileType: XfillFileType;
  sizeBytes: number;
  summary: string;
  slots: XfillSlot[];
}

export interface XfillOptions {
  contextNotes: string;
  strictGrounding: boolean;
  answerStyle: 'concise' | 'detailed' | 'bullets';
  customInstructions: string;
}
