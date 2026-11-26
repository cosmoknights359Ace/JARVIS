import {
  MemoryStore,
  JarvisSettings,
  ChatMessage,
  EngineProvider,
  SystemStats,
  WarmUpStatus,
  HardwareProfile
} from '../types';
import { getShort } from './attribution';
import { formatHardwareReadout, selectBestModelForTier } from '../utils/hardwareTier';

export const CODING_KEYWORDS = [
  'code', 'python', 'java', 'c++', 'javascript', 'typescript', 'html', 'css',
  'program', 'script', 'leetcode', 'bug', 'error', 'debug', 'function', 'class',
  'react', 'sql', 'api', 'compile', 'algorithm', 'loop', 'variable', 'component',
  'rust', 'golang', 'csharp', 'c#'
];

export interface QuickSlashCommand {
  slash: string;
  command: string;
  label: string;
  description: string;
  needsArg?: boolean;
  placeholder?: string;
}

export const QUICK_SLASH_COMMANDS: QuickSlashCommand[] = [
  {
    slash: '/status',
    command: 'system status',
    label: 'System Status',
    description: 'Check active AI provider, latency, memory count, and route'
  },
  {
    slash: '/memory',
    command: 'show memory',
    label: 'Show Memory',
    description: 'List all persistent facts stored in your memory bank'
  },
  {
    slash: '/remember',
    command: 'remember key=value',
    label: 'Save Memory',
    description: 'Store a persistent key=value fact in memory',
    needsArg: true,
    placeholder: 'remember topic=Quantum Computing'
  },
  {
    slash: '/recall',
    command: 'recall ',
    label: 'Recall Fact',
    description: 'Retrieve a specific value from memory by key',
    needsArg: true,
    placeholder: 'recall topic'
  },
  {
    slash: '/note',
    command: 'note ',
    label: 'Quick Note',
    description: 'Save a timestamped note directly into persistent memory',
    needsArg: true,
    placeholder: 'note Review neural router benchmarks'
  },
  {
    slash: '/calc',
    command: 'calc (128 * 16) + 512',
    label: 'Instant Calculator',
    description: 'Evaluate a mathematical expression immediately',
    needsArg: true,
    placeholder: 'calc 24 * 60'
  },
  {
    slash: '/time',
    command: 'what time is it',
    label: 'Current Time',
    description: 'Display and speak the current clock time'
  },
  {
    slash: '/date',
    command: 'whats todays date',
    label: 'Current Date',
    description: 'Display today’s full calendar date'
  },
  {
    slash: '/code',
    command: 'Write a clean Python async task queue with worker pool and retry logic',
    label: 'Code Synthesis',
    description: 'Route directly to the coder model for programming tasks'
  },
  {
    slash: '/export',
    command: 'export chat',
    label: 'Export Session',
    description: 'Download the current conversation as a Markdown file'
  },
  {
    slash: '/clear',
    command: 'clear screen',
    label: 'Clear Screen',
    description: 'Reset the active chat display for a fresh start'
  },
  {
    slash: '/help',
    command: 'help',
    label: 'All Commands',
    description: 'Display the complete command reference in chat'
  }
];

export interface CapabilityItem {
  command: string;
  label: string;
  description: string;
  example: string;
}

export interface CapabilityCategory {
  id: string;
  title: string;
  subtitle: string;
  items: CapabilityItem[];
}

export const CAPABILITY_CATEGORIES: CapabilityCategory[] = [
  {
    id: 'memory',
    title: 'Memory & Notes',
    subtitle: 'Store, retrieve, and manage persistent facts injected into prompts.',
    items: [
      {
        command: 'remember focus=Futuristic UI Architecture',
        label: 'Save Fact to Memory',
        description: 'Stores a key=value pair persistently.',
        example: 'remember key=value'
      },
      {
        command: 'note Finalize shader animation timing',
        label: 'Save Timestamped Note',
        description: 'Logs a quick numbered note into your memory bank.',
        example: 'note <text>'
      },
      {
        command: 'recall focus',
        label: 'Recall Specific Memory',
        description: 'Fetches the stored value for a given key.',
        example: 'recall <key>'
      },
      {
        command: 'show memory',
        label: 'List All Stored Memories',
        description: 'Displays all active key-value facts.',
        example: 'show memory'
      },
      {
        command: 'forget focus',
        label: 'Delete Memory Entry',
        description: 'Removes a specific key from memory.',
        example: 'forget <key>'
      }
    ]
  },
  {
    id: 'utilities',
    title: 'Instant Utilities & Diagnostics',
    subtitle: 'Zero-latency tools for math, time, status, and power confirmation gates.',
    items: [
      {
        command: 'system status',
        label: 'Engine & Latency Diagnostics',
        description: 'Checks active engine provider, probe latency, model route, and memory count.',
        example: '/status or system status'
      },
      {
        command: 'calc (1024 * 64) / 8',
        label: 'Instant Math Evaluator',
        description: 'Computes arithmetic expressions immediately.',
        example: 'calc <expression>'
      },
      {
        command: 'what time is it',
        label: 'Current Time',
        description: 'Reads out the current local time.',
        example: '/time or what time is it'
      },
      {
        command: 'whats todays date',
        label: 'Current Date',
        description: 'Returns the full weekday, month, day, and year.',
        example: '/date or whats todays date'
      },
      {
        command: 'shutdown pc',
        label: 'Guarded System Shutdown',
        description: 'Initiates a yes/no confirmation gate before shutdown.',
        example: 'shutdown pc'
      }
    ]
  },
  {
    id: 'launchers',
    title: 'Web & App Shortcuts',
    subtitle: 'Open external web tools or search directly from the command bar.',
    items: [
      {
        command: 'search local llm inference optimization',
        label: 'Web Search Query',
        description: 'Opens a web search link for any topic.',
        example: 'search <query>'
      },
      {
        command: 'open github',
        label: 'Open GitHub',
        description: 'Provides a direct launch link to GitHub.',
        example: 'open github'
      },
      {
        command: 'open youtube',
        label: 'Open YouTube',
        description: 'Provides a direct launch link to YouTube.',
        example: 'open youtube'
      },
      {
        command: 'open chatgpt',
        label: 'Open ChatGPT',
        description: 'Provides a direct launch link to ChatGPT.',
        example: 'open chatgpt'
      }
    ]
  },
  {
    id: 'coding',
    title: 'Sticky Auto-Routed AI & Coding',
    subtitle: 'Automatically switches between fast general and coder models for 3 turns.',
    items: [
      {
        command: 'Write a clean Python async task queue with worker pool and retry logic',
        label: 'Generate Python Async Queue',
        description: 'Triggers sticky routing to coder model with syntax-highlighted output.',
        example: 'Write a Python script...'
      },
      {
        command: 'Write a thread-safe LRU Cache in Java using Generics',
        label: 'Generate Java LRU Cache',
        description: 'Synthesizes complete Java code using sticky coder routing.',
        example: 'Write a Java class...'
      },
      {
        command: 'export chat',
        label: 'Export Session to Markdown',
        description: 'Downloads the conversation transcript as a .md file.',
        example: '/export or export chat'
      },
      {
        command: 'clear screen',
        label: 'Clear Active Chat Display',
        description: 'Resets the current chat view.',
        example: '/clear or clear screen'
      }
    ]
  }
];

export const HELP_TEXT = `J.A.R.V.I.S Quick Command Guide:

Slash & Natural Commands:
- /status   or  system status         (Engine provider & latency diagnostics)
- /memory   or  show memory           (List all stored facts)
- /remember or  remember key=value    (Save a persistent fact)
- /recall   or  recall key            (Retrieve a saved fact)
- /forget   or  forget key            (Delete a saved fact)
- /note     or  note <text>           (Save a quick timestamped note)
- /calc     or  calc <math>           (Instant math calculator)
- /time     or  what time is it       (Current time)
- /date     or  whats todays date     (Today's calendar date)
- /export   or  export chat           (Save conversation as .md)
- /clear    or  clear screen          (Clear active chat display)

Web & Shortcuts:
- search <query>
- open github / open youtube / open chatgpt
- shutdown pc / restart pc (with yes/no confirmation gate)

Model Routing:
- "auto" routes between fast and coder models and stays sticky for 3 turns.

Attribution:
- ${getShort()} — Free to use, study, modify, and redistribute with creator credit retained.`;

export interface CommandResult {
  handled: boolean;
  type: 'chat' | 'system' | 'action' | 'clear' | 'export';
  text: string;
  speakText?: string;
  actionPayload?: any;
}

export interface HealthProbeResult {
  reachable: boolean;
  models: string[];
  geminiAvailable: boolean;
  activeProvider: EngineProvider;
  probeLatencyMs: number | null;
  serverUptimeSec: number | null;
  warmUpStatus: WarmUpStatus;
  warmUpModel: string | null;
  attributionVerified: boolean;
  attributionSeal: string;
  licenseFileIntact: boolean;
}

export type JarvisStreamEvent =
  | {
      type: 'status';
      phase: 'loading_model';
      provider: 'ollama' | 'gemini';
      model: string;
    }
  | {
      type: 'meta';
      provider: 'ollama' | 'gemini';
      model: string;
      ttftMs: number;
    }
  | {
      type: 'text';
      content: string;
    }
  | {
      type: 'stats';
      provider: 'ollama' | 'gemini';
      model: string;
      ttftMs: number;
      elapsedMs: number;
      tokensPerSec: number;
      doneReason?: string;
    }
  | {
      type: 'error';
      message: string;
    };

export class JarvisRouter {
  private stickyCount = 0;
  private stickyModel: string | null = null;

  public resolve(
    prompt: string,
    selectedModel: string,
    settings: JarvisSettings,
    installedModels?: string[],
    hardware?: HardwareProfile | null
  ): string {
    if (selectedModel !== 'auto') {
      return selectedModel;
    }

    const lower = prompt.toLowerCase();
    const isCoding = CODING_KEYWORDS.some((kw) => {
      const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return regex.test(lower);
    });

    const hasLocalInventory = Array.isArray(installedModels) && installedModels.length > 0;

    if (isCoding) {
      const tierCoder =
        hasLocalInventory && hardware
          ? selectBestModelForTier(installedModels, {
              hardware,
              preferCoding: true,
              preferredDefault: settings.codingModel,
              allowUnfitFallback: true
            })
          : null;
      this.stickyModel = tierCoder || settings.codingModel || 'qwen2.5-coder:7b';
      this.stickyCount = 3;
      return this.stickyModel;
    }

    if (this.stickyCount > 0 && this.stickyModel) {
      this.stickyCount--;
      return this.stickyModel;
    }

    this.stickyModel = null;
    if (hasLocalInventory && hardware) {
      const tierGeneral = selectBestModelForTier(installedModels, {
        hardware,
        preferCoding: false,
        preferredDefault: settings.generalModel,
        allowUnfitFallback: true
      });
      if (tierGeneral) {
        return tierGeneral;
      }
    }
    return settings.generalModel || 'qwen2.5:3b';
  }
}

export async function fetchSystemHardware(): Promise<HardwareProfile | null> {
  try {
    const res = await fetch('/api/system/hardware');
    if (!res.ok) return null;
    const data = await res.json();
    if (
      typeof data?.gpuName === 'string' &&
      typeof data?.vramGb === 'number' &&
      typeof data?.systemRamGb === 'number' &&
      typeof data?.tier === 'string' &&
      typeof data?.recommendedMaxParamsB === 'number' &&
      typeof data?.defaultCtx === 'number'
    ) {
      return {
        gpuName: data.gpuName,
        vramGb: data.vramGb,
        systemRamGb: data.systemRamGb,
        tier: data.tier,
        recommendedMaxParamsB: data.recommendedMaxParamsB,
        defaultCtx: data.defaultCtx
      };
    }
  } catch {
    // Hardware endpoint unreachable
  }
  return null;
}

export function buildSystemPrompt(memory: MemoryStore): string {
  const memKeys = Object.keys(memory);
  const memoryText =
    memKeys.length === 0
      ? '(no memories stored yet)'
      : memKeys.map((k) => `${k}: ${memory[k]}`).join('\n');

  return `You are J.A.R.V.I.S, a concise and technically accurate personal AI assistant.\n\nUser memory:\n${memoryText}\n\nRespond clearly using clean Markdown (headings, lists, tables, and language-tagged code fences when appropriate).`;
}

export async function probeLocalOllama(host: string): Promise<HealthProbeResult> {
  const started = performance.now();
  try {
    const res = await fetch(
      `/api/jarvis/health?host=${encodeURIComponent(host || 'http://localhost:11434')}`
    );
    if (res.ok) {
      const data = await res.json();
      const measuredMs = Math.max(1, Math.round(performance.now() - started));
      const reachable = Boolean(data?.reachable);
      const geminiAvailable = Boolean(data?.geminiAvailable);
      const activeProvider: EngineProvider =
        data?.activeProvider === 'ollama' ||
        data?.activeProvider === 'gemini' ||
        data?.activeProvider === 'offline'
          ? data.activeProvider
          : reachable
          ? 'ollama'
          : geminiAvailable
          ? 'gemini'
          : 'offline';

      const rawWarmStatus = data?.warmUp?.status;
      const warmUpStatus: WarmUpStatus =
        rawWarmStatus === 'warming' ||
        rawWarmStatus === 'ready' ||
        rawWarmStatus === 'skipped' ||
        rawWarmStatus === 'failed' ||
        rawWarmStatus === 'idle'
          ? rawWarmStatus
          : reachable
          ? 'ready'
          : 'idle';
      const warmUpModel =
        typeof data?.warmUp?.model === 'string' && data.warmUp.model.trim()
          ? data.warmUp.model.trim()
          : null;

      return {
        reachable,
        models: Array.isArray(data?.models) ? data.models : [],
        geminiAvailable,
        activeProvider,
        probeLatencyMs:
          typeof data?.probeLatencyMs === 'number' ? data.probeLatencyMs : measuredMs,
        serverUptimeSec:
          typeof data?.serverUptimeSec === 'number' ? data.serverUptimeSec : null,
        warmUpStatus,
        warmUpModel,
        attributionVerified: data?.attribution?.verified !== false,
        attributionSeal:
          typeof data?.attribution?.seal === 'string' ? data.attribution.seal : 'ceff726d5d41618b',
        licenseFileIntact: data?.attribution?.licenseIntact !== false
      };
    }
  } catch {
    // Health endpoint unreachable
  }
  return {
    reachable: false,
    models: [],
    geminiAvailable: false,
    activeProvider: 'offline',
    probeLatencyMs: null,
    serverUptimeSec: null,
    warmUpStatus: 'idle',
    warmUpModel: null,
    attributionVerified: true,
    attributionSeal: 'ceff726d5d41618b',
    licenseFileIntact: true
  };
}

export function handleCommand(
  rawInput: string,
  memory: MemoryStore,
  onMemoryUpdate: (newMem: MemoryStore) => void,
  pendingConfirmation: 'shutdown' | 'restart' | null,
  setPendingConfirmation: (val: 'shutdown' | 'restart' | null) => void,
  stats: SystemStats
): CommandResult {
  const text = rawInput.trim().replace(/^\//, '');
  const lower = text.toLowerCase();

  // 1. Pending confirmation gate
  if (pendingConfirmation) {
    if (lower === 'yes' || lower === 'y' || lower.includes('confirm')) {
      const action = pendingConfirmation;
      setPendingConfirmation(null);
      return {
        handled: true,
        type: 'action',
        text: `Confirmed. Power sequence (${action}) acknowledged.`,
        speakText: `Initiating ${action} sequence now.`
      };
    } else {
      setPendingConfirmation(null);
      return {
        handled: true,
        type: 'chat',
        text: 'Action cancelled. All systems remain operational.',
        speakText: 'Action cancelled.'
      };
    }
  }

  // 2. Shutdown / Restart
  if (lower === 'shutdown pc' || lower === 'shutdown') {
    setPendingConfirmation('shutdown');
    return {
      handled: true,
      type: 'chat',
      text: 'Confirmation required: Are you sure you want to shut down? Reply **yes** to confirm or **no** to cancel.',
      speakText: 'Are you sure you want to shut down? Say yes or no.'
    };
  }

  if (lower === 'restart pc' || lower === 'restart') {
    setPendingConfirmation('restart');
    return {
      handled: true,
      type: 'chat',
      text: 'Confirmation required: Are you sure you want to restart? Reply **yes** to confirm or **no** to cancel.',
      speakText: 'Are you sure you want to restart? Say yes or no.'
    };
  }

  // 3. Help
  if (lower === 'help' || lower === 'commands' || lower === '?') {
    return {
      handled: true,
      type: 'chat',
      text: `\`\`\`text\n${HELP_TEXT}\n\`\`\``,
      speakText: 'Displaying the command reference guide.'
    };
  }

  // 4. Instant Calculator (`calc <expr>`)
  if (lower.startsWith('calc ') || lower.startsWith('calculate ')) {
    const expr = text.replace(/^(calc|calculate)\s+/i, '').trim();
    const sanitized = expr.replace(/[^0-9+\-*/().%\s^]/g, '');
    if (!sanitized) {
      return {
        handled: true,
        type: 'chat',
        text: 'Provide a math expression, e.g. `calc (128 * 16) + 512`.',
        speakText: 'Please provide a mathematical expression.'
      };
    }
    try {
      const normalized = sanitized.replace(/\^/g, '**');
      // eslint-disable-next-line no-new-func
      const result = Function(`"use strict"; return (${normalized});`)();
      return {
        handled: true,
        type: 'chat',
        text: `Calculation Result:\n\`${expr}\` = **${result}**`,
        speakText: `The result is ${result}`
      };
    } catch {
      return {
        handled: true,
        type: 'chat',
        text: `Could not evaluate expression \`${expr}\`. Check syntax and try again.`,
        speakText: 'Could not evaluate that expression.'
      };
    }
  }

  // 5. Quick Note (`note <text>`)
  if (lower.startsWith('note ')) {
    const noteBody = text.slice(5).trim();
    if (!noteBody) {
      return {
        handled: true,
        type: 'chat',
        text: 'Usage: `note <your note text>`',
        speakText: 'Please provide text for your note.'
      };
    }
    const key = `note_${new Date()
      .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      .replace(/\s+/g, '')}`;
    const updated = { ...memory, [key]: noteBody };
    onMemoryUpdate(updated);
    return {
      handled: true,
      type: 'chat',
      text: `Logged note to memory (**${key}**): \`${noteBody}\``,
      speakText: 'Note saved to memory.'
    };
  }

  // 6. Memory Commands
  if (lower.startsWith('remember ')) {
    const rest = text.slice(9).trim();
    if (!rest.includes('=')) {
      return {
        handled: true,
        type: 'chat',
        text: 'Use format `remember key=value` — for example: `remember theme=Black and Orange`',
        speakText: 'Please use format remember key equals value.'
      };
    }
    const eqIdx = rest.indexOf('=');
    const key = rest.slice(0, eqIdx).trim();
    const val = rest.slice(eqIdx + 1).trim();
    if (!key) {
      return {
        handled: true,
        type: 'chat',
        text: 'Memory key cannot be empty.',
        speakText: 'Memory key cannot be empty.'
      };
    }
    const updated = { ...memory, [key]: val };
    onMemoryUpdate(updated);
    return {
      handled: true,
      type: 'chat',
      text: `Saved memory: **${key}** = \`${val}\``,
      speakText: `Saved memory ${key} equals ${val}`
    };
  }

  if (lower.startsWith('recall ')) {
    const key = text.slice(7).trim();
    if (key in memory) {
      return {
        handled: true,
        type: 'chat',
        text: `**${key}** = \`${memory[key]}\``,
        speakText: `${key} is ${memory[key]}`
      };
    }
    return {
      handled: true,
      type: 'chat',
      text: `No stored memory found for key \`${key}\`.`,
      speakText: `I don't have a memory for ${key} yet.`
    };
  }

  if (lower.startsWith('forget ')) {
    const key = text.slice(7).trim();
    if (key in memory) {
      const updated = { ...memory };
      delete updated[key];
      onMemoryUpdate(updated);
      return {
        handled: true,
        type: 'chat',
        text: `Removed \`${key}\` from persistent memory.`,
        speakText: `Forgot ${key}.`
      };
    }
    return {
      handled: true,
      type: 'chat',
      text: `Key \`${key}\` was not found in memory.`,
      speakText: 'That key was not found in memory.'
    };
  }

  if (lower === 'show memory' || lower === 'memory') {
    const keys = Object.keys(memory);
    if (keys.length === 0) {
      return {
        handled: true,
        type: 'chat',
        text: 'Memory store is currently empty. Add facts using `remember key=value`.',
        speakText: 'Memory is currently empty.'
      };
    }
    const lines = keys.map((k) => `- **${k}**: \`${memory[k]}\``).join('\n');
    return {
      handled: true,
      type: 'chat',
      text: `Stored Memory (${keys.length} items):\n\n${lines}`,
      speakText: `You have ${keys.length} saved memories.`
    };
  }

  // 7. Time & Date
  if (lower === 'what time is it' || lower === 'time' || lower === 'current time') {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    return {
      handled: true,
      type: 'chat',
      text: `The current time is **${timeStr}**.`,
      speakText: `The current time is ${timeStr}`
    };
  }

  if (
    lower === 'whats todays date' ||
    lower === "what's today's date" ||
    lower === 'date' ||
    lower === 'today'
  ) {
    const now = new Date();
    const dateStr = now.toLocaleDateString([], {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    return {
      handled: true,
      type: 'chat',
      text: `Today's date is **${dateStr}**.`,
      speakText: `Today is ${dateStr}`
    };
  }

  // 8. Real System & Engine Diagnostics
  if (
    lower === 'battery' ||
    lower === 'system status' ||
    lower === 'status' ||
    lower === 'diagnostics'
  ) {
    const providerLabel =
      stats.activeProvider === 'ollama'
        ? `Local Ollama (${stats.installedModels.length} models installed)`
        : stats.activeProvider === 'gemini'
        ? 'Gemini Cloud (gemini-4-hydrogen)'
        : 'Offline (No provider reachable)';
    const probeText =
      stats.probeLatencyMs !== null ? `${stats.probeLatencyMs} ms` : 'Unavailable';
    const lastPerfText =
      stats.lastTtftMs !== null && stats.lastTokensPerSec !== null
        ? `TTFT ${stats.lastTtftMs} ms · ${stats.lastTokensPerSec} tok/s`
        : 'No turns completed yet';

    const hardwareRow = stats.hardware
      ? `| Hardware | \`${formatHardwareReadout(stats.hardware, { compact: true })}\` |\n`
      : '';

    return {
      handled: true,
      type: 'chat',
      text: `### Engine Diagnostics\n\n| Metric | Value |\n| --- | --- |\n| Active Provider | **${providerLabel}** |\n${hardwareRow}| Preferred Route | \`${stats.resolvedModel}\` |\n| Probe Latency | \`${probeText}\` |\n| Last Inference | \`${lastPerfText}\` |\n| Memory Records | \`${Object.keys(memory).length} entries\` |\n| Attribution | ${getShort()} |`,
      speakText:
        stats.activeProvider === 'ollama'
          ? 'Local Ollama engine is connected and nominal.'
          : stats.activeProvider === 'gemini'
          ? 'Gemini cloud engine is active and ready.'
          : 'No AI provider is currently reachable.'
    };
  }

  // 9. Clear screen / Export
  if (
    lower === 'clear screen' ||
    lower === 'clear chat' ||
    lower === 'clear history' ||
    lower === 'clear'
  ) {
    return {
      handled: true,
      type: 'clear',
      text: 'Chat display cleared.',
      speakText: 'Display cleared.'
    };
  }

  if (lower === 'export chat' || lower === 'export') {
    return {
      handled: true,
      type: 'export',
      text: 'Exporting conversation to Markdown...',
      speakText: 'Exporting conversation.'
    };
  }

  // 10. Web Launchers
  const websiteMap: Record<string, { label: string; url: string }> = {
    'open youtube': { label: 'YouTube', url: 'https://youtube.com' },
    'open github': { label: 'GitHub', url: 'https://github.com' },
    'open chatgpt': { label: 'ChatGPT', url: 'https://chatgpt.com' },
    'open google': { label: 'Google', url: 'https://google.com' }
  };

  if (lower in websiteMap) {
    const { label, url } = websiteMap[lower];
    return {
      handled: true,
      type: 'chat',
      text: `Ready to launch **${label}**: [${url}](${url})`,
      speakText: `Opening ${label}.`
    };
  }

  if (lower.startsWith('search ')) {
    const query = text.slice(7).trim();
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    return {
      handled: true,
      type: 'chat',
      text: `Web Search ready for **"${query}"**: [Open Search Results](${url})`,
      speakText: `Searching for ${query}.`
    };
  }

  return { handled: false, type: 'chat', text: '' };
}

export async function* streamJarvisResponse(
  userText: string,
  modelName: string,
  memory: MemoryStore,
  chatHistory: ChatMessage[],
  settings: JarvisSettings,
  signal?: AbortSignal
): AsyncGenerator<JarvisStreamEvent, void, unknown> {
  const sysPrompt = buildSystemPrompt(memory);
  const recentTurns = chatHistory
    .filter((m) => (m.role === 'user' || m.role === 'assist') && !m.isError && m.content.trim())
    .slice(-6)
    .map((m) => ({
      role: m.role === 'user' ? 'user' : 'assist',
      content: m.content
    }));

  try {
    const response = await fetch('/api/jarvis/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        prompt: userText,
        history: recentTurns,
        systemInstruction: sysPrompt,
        temperature: settings.temperature,
        modelName,
        ollamaHost: settings.ollamaHost || 'http://localhost:11434',
        keepAliveMinutes: settings.keepAliveMinutes,
        maxTokens: settings.maxTokens
      })
    });

    if (!response.ok) {
      let errMsg = `Request failed with status ${response.status}.`;
      try {
        const data = await response.json();
        if (data?.error) errMsg = data.error;
      } catch {
        // ignore JSON parse error
      }
      yield { type: 'error', message: errMsg };
      return;
    }

    if (!response.body) {
      yield { type: 'error', message: 'Empty stream returned by server.' };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';
    let sseBuffer = '';

    const onAbort = () => {
      reader.cancel().catch(() => {});
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      while (true) {
        if (signal?.aborted) return;
        const { done, value } = await reader.read();
        if (done || signal?.aborted) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const events = sseBuffer.split('\n\n');
        sseBuffer = events.pop() || '';

        for (const evt of events) {
          if (signal?.aborted) return;
          const lines = evt.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === '[DONE]') return;

            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.error) {
                yield { type: 'error', message: String(parsed.error) };
                return;
              }
              if (parsed.status && parsed.status.phase === 'loading_model') {
                yield {
                  type: 'status',
                  phase: 'loading_model',
                  provider: parsed.status.provider === 'gemini' ? 'gemini' : 'ollama',
                  model: String(parsed.status.model || modelName)
                };
              }
              if (parsed.meta) {
                yield {
                  type: 'meta',
                  provider: parsed.meta.provider,
                  model: parsed.meta.model,
                  ttftMs: Number(parsed.meta.ttftMs) || 0
                };
              }
              if (typeof parsed.text === 'string' && parsed.text.length > 0) {
                accumulated += parsed.text;
                yield { type: 'text', content: accumulated };
              }
              if (parsed.stats) {
                yield {
                  type: 'stats',
                  provider: parsed.stats.provider,
                  model: parsed.stats.model,
                  ttftMs: Number(parsed.stats.ttftMs) || 0,
                  elapsedMs: Number(parsed.stats.elapsedMs) || 0,
                  tokensPerSec: Number(parsed.stats.tokensPerSec) || 0,
                  doneReason:
                    typeof parsed.stats.doneReason === 'string'
                      ? parsed.stats.doneReason
                      : undefined
                };
              }
            } catch {
              // ignore malformed SSE chunk
            }
          }
        }
      }

      if (signal?.aborted) return;

      if (sseBuffer.trim()) {
        for (const line of sseBuffer.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') break;
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.error) {
              yield { type: 'error', message: String(parsed.error) };
              return;
            }
            if (typeof parsed.text === 'string' && parsed.text.length > 0) {
              accumulated += parsed.text;
              yield { type: 'text', content: accumulated };
            }
            if (parsed.stats) {
              yield {
                type: 'stats',
                provider: parsed.stats.provider,
                model: parsed.stats.model,
                ttftMs: Number(parsed.stats.ttftMs) || 0,
                elapsedMs: Number(parsed.stats.elapsedMs) || 0,
                tokensPerSec: Number(parsed.stats.tokensPerSec) || 0,
                doneReason:
                  typeof parsed.stats.doneReason === 'string'
                    ? parsed.stats.doneReason
                    : undefined
              };
            }
          } catch {
            // ignore trailing partial frame
          }
        }
      }

      if (signal?.aborted) return;

      if (!accumulated.trim()) {
        yield {
          type: 'error',
          message: 'No response was generated. Verify your local Ollama server or Gemini API key.'
        };
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  } catch (err: any) {
    if (signal?.aborted || err?.name === 'AbortError') {
      return;
    }
    yield {
      type: 'error',
      message:
        err?.message ||
        'Network error communicating with J.A.R.V.I.S server. Check your connection and retry.'
    };
  }
}
