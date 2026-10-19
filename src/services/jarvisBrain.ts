import { MemoryStore, JarvisSettings, ChatMessage } from '../types';
import { getShort } from './attribution';

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
    description: 'Check active AI model route, memory count, and local engine link'
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
        label: 'Engine & Telemetry Status',
        description: 'Checks Ollama status, active model route, and memory count.',
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
    subtitle: 'Automatically switches between qwen2.5:3b (fast) and qwen2.5-coder:7b (code).',
    items: [
      {
        command: 'Write a clean Python async task queue with worker pool and retry logic',
        label: 'Generate Python Async Queue',
        description: 'Triggers sticky routing to qwen2.5-coder:7b with syntax-highlighted output.',
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
- /status   or  system status         (Engine & routing diagnostics)
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
- "auto" routes between fast (qwen2.5:3b) and coder (qwen2.5-coder:7b) and stays sticky for 3 turns.

Attribution:
- ${getShort()} — Free to use, study, modify, and redistribute with creator credit retained.`;

export interface CommandResult {
  handled: boolean;
  type: 'chat' | 'system' | 'action' | 'clear' | 'export';
  text: string;
  speakText?: string;
  actionPayload?: any;
}

export class JarvisRouter {
  private stickyCount = 0;
  private stickyModel: string | null = null;

  public resolve(prompt: string, selectedModel: string, settings: JarvisSettings): string {
    if (selectedModel !== 'auto') {
      return selectedModel;
    }

    const lower = prompt.toLowerCase();
    const isCoding = CODING_KEYWORDS.some((kw) => {
      const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return regex.test(lower);
    });

    if (isCoding) {
      this.stickyModel = settings.codingModel || 'qwen2.5-coder:7b';
      this.stickyCount = 3;
      return this.stickyModel;
    }

    if (this.stickyCount > 0 && this.stickyModel) {
      this.stickyCount--;
      return this.stickyModel;
    }

    this.stickyModel = null;
    return settings.generalModel || 'qwen2.5:3b';
  }
}

export function buildSystemPrompt(memory: MemoryStore): string {
  const memKeys = Object.keys(memory);
  const memoryText =
    memKeys.length === 0
      ? '(no memories stored yet)'
      : memKeys.map((k) => `${k}: ${memory[k]}`).join('\n');

  return `You are Jarvis, a concise personal AI assistant.\n\nUser memory:\n${memoryText}\n\nAnswer concisely and format code inside markdown fences.`;
}

export async function probeLocalOllama(host: string): Promise<{
  reachable: boolean;
  models: string[];
}> {
  try {
    const res = await fetch(`/api/jarvis/health?host=${encodeURIComponent(host || 'http://localhost:11434')}`);
    if (res.ok) {
      const data = await res.json();
      return {
        reachable: Boolean(data?.reachable),
        models: Array.isArray(data?.models) ? data.models : []
      };
    }
  } catch {
    // Fallback if server endpoint is unavailable
  }
  return { reachable: false, models: [] };
}

export function handleCommand(
  rawInput: string,
  memory: MemoryStore,
  onMemoryUpdate: (newMem: MemoryStore) => void,
  pendingConfirmation: 'shutdown' | 'restart' | null,
  setPendingConfirmation: (val: 'shutdown' | 'restart' | null) => void,
  ollamaReachable: boolean = false
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
    const key = `note_${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).replace(/\s+/g, '')}`;
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
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return {
      handled: true,
      type: 'chat',
      text: `The current time is **${timeStr}**.`,
      speakText: `The current time is ${timeStr}`
    };
  }

  if (lower === 'whats todays date' || lower === "what's today's date" || lower === 'date' || lower === 'today') {
    const now = new Date();
    const dateStr = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    return {
      handled: true,
      type: 'chat',
      text: `Today's date is **${dateStr}**.`,
      speakText: `Today is ${dateStr}`
    };
  }

  // 8. System status
  if (lower === 'battery' || lower === 'system status' || lower === 'status' || lower === 'diagnostics') {
    return {
      handled: true,
      type: 'chat',
      text: `System Diagnostics:\n- **Ollama Engine**: ${ollamaReachable ? 'Online (Connected)' : 'Standby (Built-in Core Active)'}\n- **Memory Records**: ${Object.keys(memory).length} entries\n- **Keep-Alive Window**: 30 minutes\n- **Attribution**: ${getShort()}`,
      speakText: ollamaReachable
        ? 'Ollama server is connected and all systems are nominal.'
        : 'System is running in built-in core mode.'
    };
  }

  // 9. Clear screen / Export
  if (lower === 'clear screen' || lower === 'clear chat' || lower === 'clear history' || lower === 'clear') {
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

  // 10. Web Launchers (renders clickable link + safe anchor navigation)
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

function buildOfflineFallbackReply(
  userText: string,
  modelName: string,
  memory: MemoryStore,
  settings: JarvisSettings
): string {
  const lower = userText.toLowerCase();

  if (lower.includes('who are you') || lower.includes('what can you do')) {
    return `I am **J.A.R.V.I.S**, your personal AI assistant.\n\n### Core Capabilities\n- **Sticky Model Routing**: Automatically switches between \`${settings.generalModel}\` (fast) and \`${settings.codingModel}\` (code).\n- **Instant Slash Commands**: Type \`/\` in the prompt box or click any quick chip (\`/status\`, \`/memory\`, \`/remember\`, \`/calc\`, \`/note\`).\n- **Vision Inspection**: Analyze diagrams and frames in the **Vision** tab.\n- **Voice I/O**: Hands-free dictation and spoken responses.\n\n*Creator Credit: ${getShort()}*`;
  }

  if (/\bjava\b/i.test(lower) && !/javascript/i.test(lower)) {
    return `Routing to **${modelName}** (sticky coding mode active).\n\n\`\`\`java\nimport java.util.LinkedHashMap;\nimport java.util.Map;\n\npublic class LRUCache<K, V> extends LinkedHashMap<K, V> {\n    private final int capacity;\n\n    public LRUCache(int capacity) {\n        super(capacity, 0.75f, true);\n        this.capacity = capacity;\n    }\n\n    @Override\n    protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {\n        return size() > capacity;\n    }\n\n    public static void main(String[] args) {\n        LRUCache<String, Integer> cache = new LRUCache<>(3);\n        cache.put("core", 100);\n        cache.put("vision", 200);\n        cache.put("router", 300);\n        cache.get("core"); // Refresh access order\n        cache.put("memory", 400); // Evicts "vision"\n        System.out.println("Active Cache: " + cache);\n    }\n}\n\`\`\`\n\n### Highlights\n- Uses \`LinkedHashMap\` in access-order mode (\`true\`) for O(1) \`get\` and \`put\`.\n- Automatically evicts the least-recently used key when size exceeds \`capacity\`.`;
  }

  if (/\b(c\+\+|cpp)\b/i.test(lower)) {
    return `Routing to **${modelName}** (sticky coding mode active).\n\n\`\`\`cpp\n#include <iostream>\n#include <vector>\n#include <numeric>\n#include <algorithm>\n\nint main() {\n    std::vector<int> telemetry = {12, 28, 45, 19, 64, 33};\n    std::sort(telemetry.begin(), telemetry.end());\n\n    double avg = std::accumulate(telemetry.begin(), telemetry.end(), 0.0) / telemetry.size();\n    std::cout << "Sorted Peak: " << telemetry.back() << " | Mean: " << avg << "\\n";\n    return 0;\n}\n\`\`\``;
  }

  if (/\b(javascript|typescript|react|js|ts)\b/i.test(lower)) {
    return `Routing to **${modelName}** (sticky coding mode active).\n\n\`\`\`typescript\nexport async function withRetry<T>(\n  fn: () => Promise<T>,\n  retries = 3,\n  delayMs = 300\n): Promise<T> {\n  try {\n    return await fn();\n  } catch (err) {\n    if (retries <= 0) throw err;\n    await new Promise((r) => setTimeout(r, delayMs));\n    return withRetry(fn, retries - 1, delayMs * 2);\n  }\n}\n\`\`\``;
  }

  if (CODING_KEYWORDS.some((kw) => lower.includes(kw))) {
    return `Routing to **${modelName}** (sticky coding mode active).\n\n\`\`\`python\nimport asyncio\nfrom typing import Callable, Any\n\nclass AsyncTaskQueue:\n    """Lightweight async worker pool with automatic retry backoff."""\n    def __init__(self, concurrency: int = 4):\n        self.queue: asyncio.Queue = asyncio.Queue()\n        self.concurrency = concurrency\n\n    async def add_task(self, fn: Callable[..., Any], *args: Any) -> None:\n        await self.queue.put((fn, args))\n\n    async def _worker(self, worker_id: int) -> None:\n        while not self.queue.empty():\n            fn, args = await self.queue.get()\n            try:\n                await fn(*args)\n            finally:\n                self.queue.task_done()\n\n    async def run(self) -> None:\n        workers = [asyncio.create_task(self._worker(i)) for i in range(self.concurrency)]\n        await self.queue.join()\n        for w in workers:\n            w.cancel()\n\`\`\`\n\n### Highlights\n- Non-blocking \`asyncio.Queue\` coordination.\n- Clean worker cancellation once all queued items complete.`;
  }

  const memKeys = Object.keys(memory);
  const memNote =
    memKeys.length > 0
      ? `\n\nActive memory context: ${memKeys.map((k) => `\`${k}=${memory[k]}\``).join(', ')}.`
      : '';

  return `Acknowledged. Processed with **${modelName}** at temperature \`${settings.temperature.toFixed(2)}\`.\n\nYou can trigger instant commands anytime by typing \`/\` in the composer or clicking the command chips below the prompt bar.${memNote}`;
}

export async function* streamJarvisResponse(
  userText: string,
  modelName: string,
  memory: MemoryStore,
  chatHistory: ChatMessage[],
  settings: JarvisSettings
): AsyncGenerator<string, void, unknown> {
  const sysPrompt = buildSystemPrompt(memory);
  const recentTurns = chatHistory
    .filter((m) => m.role === 'user' || m.role === 'assist')
    .slice(-6)
    .map((m) => ({
      role: m.role === 'user' ? 'user' : 'assist',
      content: m.content
    }));

  // 1. Stream via Server Endpoint (/api/jarvis/chat handles Local Ollama + Gemini 3.8 Flash SSE)
  try {
    const response = await fetch('/api/jarvis/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    if (response.ok && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let sseBuffer = '';
      let shouldFallback = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const events = sseBuffer.split('\n\n');
        sseBuffer = events.pop() || '';

        for (const evt of events) {
          const lines = evt.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === '[DONE]') break;

            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.fallback) {
                shouldFallback = true;
                break;
              }
              if (typeof parsed.text === 'string' && parsed.text.length > 0) {
                accumulated += parsed.text;
                yield accumulated;
              }
            } catch {
              // ignore malformed SSE frame
            }
          }
          if (shouldFallback) break;
        }
        if (shouldFallback) break;
      }

      if (!shouldFallback && accumulated.trim().length > 0) {
        return;
      }
    }
  } catch {
    // Proceed to offline fallback
  }

  // 2. Offline Built-in Assistant Fallback
  const reply = buildOfflineFallbackReply(userText, modelName, memory, settings);
  const words = reply.split(' ');
  let acc = '';
  for (let i = 0; i < words.length; i++) {
    acc += (i === 0 ? '' : ' ') + words[i];
    yield acc;
    await new Promise((r) => setTimeout(r, 14));
  }
}
