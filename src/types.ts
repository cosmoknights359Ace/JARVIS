export type NavView = 'HOME' | 'CHAT' | 'XFILL' | 'SLIDES' | 'xconvert' | 'VISION' | 'MEMORY' | 'SETTINGS';

export type MessageRole = 'user' | 'assist' | 'system' | 'boot';

export type EngineProvider = 'ollama' | 'gemini' | 'offline';

export type WarmUpStatus = 'idle' | 'warming' | 'ready' | 'skipped' | 'failed';

export type HardwareTier =
  | 'CPU / Low VRAM'
  | 'Entry GPU'
  | 'Mid-Range GPU'
  | 'High-End GPU';

export type ModelFitBadge = 'Optimal' | 'Heavy' | 'Too Heavy';

export interface HardwareProfile {
  gpuName: string;
  vramGb: number;
  systemRamGb: number;
  tier: HardwareTier;
  recommendedMaxParamsB: number;
  defaultCtx: number;
}

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
  doneReason?: string;
  stoppedByUser?: boolean;
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

export interface OllamaInstalledModel {
  name: string;
  size: number | null;
  modifiedAt?: string;
  parameterSize?: string;
  quantizationLevel?: string;
}

export interface SystemStats {
  clock: string;
  isOnline: boolean;
  activeProvider: EngineProvider;
  ollamaReachable: boolean;
  ollamaProbeCompleted: boolean;
  geminiAvailable: boolean;
  probeLatencyMs: number | null;
  lastTtftMs: number | null;
  lastElapsedMs: number | null;
  lastTokensPerSec: number | null;
  serverUptimeSec: number | null;
  resolvedModel: string;
  installedModels: string[];
  installedModelDetails: OllamaInstalledModel[];
  warmUpStatus: WarmUpStatus;
  warmUpModel: string | null;
  hardware: HardwareProfile | null;
  attributionVerified: boolean;
  attributionSeal: string;
  licenseFileIntact: boolean;
}

export interface JarvisSettings {
  model: string;
  generalModel: string;
  codingModel: string;
  visionModel: string;
  xfillModel: string;
  slidesModel: string;
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

export type SlideThemeId =
  | 'obsidian-orange'
  | 'editorial-ivory'
  | 'slate-executive'
  | 'emerald-tech';

export type SlideLayoutType =
  | 'title'
  | 'bullets'
  | 'split_image'
  | 'two_column'
  | 'stat_highlight'
  | 'table'
  | 'key_takeaway';

export interface SlideTableData {
  headers: string[];
  rows: string[][];
}

export type SlideAudience = 'executive' | 'technical' | 'educational' | 'pitch';

export interface SlideImageAsset {
  url: string;
  thumbUrl: string;
  caption: string;
  credit: string;
  source: 'wikimedia' | 'openverse';
  width?: number;
  height?: number;
}

export interface SlideItem {
  id: string;
  layout: SlideLayoutType;
  kicker: string;
  title: string;
  subtitle?: string;
  leftTitle?: string;
  rightTitle?: string;
  takeaway?: string;
  bullets: string[];
  secondaryBullets?: string[];
  table?: SlideTableData;
  highlightStat?: {
    value: string;
    label: string;
  };
  speakerNotes: string;
  imageQuery: string;
  image?: SlideImageAsset | null;
}

export interface SlideDeck {
  id: string;
  title: string;
  subtitle: string;
  topic: string;
  themeId: SlideThemeId;
  audience: SlideAudience;
  provider: 'ollama' | 'gemini';
  model: string;
  createdAt: string;
  updatedAt: string;
  slides: SlideItem[];
}

