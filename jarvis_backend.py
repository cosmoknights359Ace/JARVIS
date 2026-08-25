"""Backend state/logic for J.A.R.V.I.S — GUI-agnostic and unit-testable.

Holds everything that doesn't need Tkinter: memory store, chat history,
model selection state, command handlers, and small pure helpers. The GUI
layer (jarvis_gui.JarvisWindow) owns widgets and delegates here.
"""
import json
import os
import re
from datetime import datetime

import jarvis_providers as providers

# ---------------------------------------------------------------------------
# Constants (moved from jarvis_gui so tests can import without Tk)
# ---------------------------------------------------------------------------

CODING_KEYWORDS = [
    "code", "python", "java", "c++", "javascript", "html", "css",
    "program", "script", "leetcode", "bug", "error", "debug",
]

APP_COMMANDS = {
    "open vscode": "vscode",
    "open edge": "edge",
    "open downloads": "downloads",
}

WEBSITE_COMMANDS = {
    "open youtube": "https://youtube.com",
    "open github": "https://github.com",
    "open chatgpt": "https://chatgpt.com",
}

HELP_TEXT = """
Jarvis Commands:

Memory:
- remember key=value
- recall key
- show memory
- forget key

Vision:
- analyze image        (opens a file picker to analyze any picture)
- (or click the image button / "Vision" in the sidebar for a screenshot)

Chat history:
- clear history         (wipes saved conversation history)
- export chat           (save the conversation as a .md file)

Conversation controls:
- regenerate            (redo the last answer)
- stop                  (cancel a reply mid-stream)
- Up / Down in the composer recalls previous messages

Apps:
- open edge / open vscode / open downloads

Websites:
- open youtube / open github / open chatgpt

Utilities:
- what time is it
- whats todays date
- battery / system status
- shutdown pc / restart pc

Models:
- "auto" routes between a fast model and a coding model (sticky per topic)
- "cloud/..." entries use your configured API endpoint instead of local Ollama
- Model, temperature, response length, and keep-alive live in Settings

Composer:
- Enter          send
- Shift+Enter    newline
- Esc            clear the composer
"""


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def ts():
    return datetime.now().strftime("%H:%M:%S")


def strip_markdown_for_speech(text):
    """Remove code fences/inline markers so TTS doesn't spell out syntax."""
    cleaned = re.sub(r"```.*?```", " (code block) ", text, flags=re.DOTALL)
    cleaned = re.sub(r"[*_`#]", "", cleaned)
    return cleaned.strip()


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def dedupe_keep_order(items):
    seen = set()
    out = []
    for it in items:
        if it not in seen:
            seen.add(it)
            out.append(it)
    return out


def model_matches(requested, installed):
    """True if `requested` (e.g. 'qwen2.5:3b') is covered by an installed name
    (exact match, or installed 'qwen2.5:3b-instruct' style prefix)."""
    base = requested.split(":")[0] + ":"
    return any(requested == i or i.startswith(base) for i in installed)


# ---------------------------------------------------------------------------
# Persistent state
# ---------------------------------------------------------------------------


class MemoryStore:
    def __init__(self, path):
        self.path = path
        self.data = self._load()

    def _load(self):
        try:
            with open(self.path, encoding="utf-8") as f:
                obj = json.load(f)
            return obj if isinstance(obj, dict) else {}
        except Exception:
            return {}

    def save(self):
        try:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2)
        except OSError:
            pass

    # dict-ish conveniences
    def __contains__(self, k):
        return k in self.data

    def __getitem__(self, k):
        return self.data[k]

    def __setitem__(self, k, v):
        self.data[k] = v
        self.save()

    def __delitem__(self, k):
        del self.data[k]
        self.save()

    def clear(self):
        self.data.clear()
        self.save()

    def items(self):
        return self.data.items()

    def render(self):
        return "\n".join(f"{k}: {v}" for k, v in self.data.items()) or "(none)"


class ChatHistory:
    """Rolling message list persisted to disk, capped at `maxlen`."""

    def __init__(self, path, maxlen=200):
        self.path = path
        self.maxlen = maxlen
        self.messages = self._load()

    def _load(self):
        try:
            with open(self.path, encoding="utf-8") as f:
                obj = json.load(f)
            msgs = obj if isinstance(obj, list) else []
            return [m for m in msgs
                    if isinstance(m, dict) and "role" in m and "content" in m]
        except Exception:
            return []

    def save(self):
        try:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(self.messages[-self.maxlen:], f, indent=2)
        except OSError:
            pass

    def append(self, role, content):
        self.messages.append({"role": role, "content": content})
        del self.messages[:-self.maxlen]
        self.save()

    def tail(self, n):
        return self.messages[-n:] if n > 0 else list(self.messages)

    def clear(self):
        self.messages.clear()
        self.save()

    def __len__(self):
        return len(self.messages)


# ---------------------------------------------------------------------------
# Model state (selection + routing, provider-aware)
# ---------------------------------------------------------------------------


class ModelState:
    """Tracks current selection, the registry, and sticky auto routing."""

    def __init__(self, cfg=None):
        self.reload(cfg)

    def reload(self, cfg=None):
        self.cfg = cfg if cfg is not None else providers.load_config()
        self.registry = providers.build_model_registry(self.cfg)
        self.auto_routes = providers.auto_routes(self.cfg)
        self.router = providers.AutoRouter(
            self.auto_routes, CODING_KEYWORDS, sticky_threshold=3)
        self.current = "auto"

    @property
    def model_ids(self):
        return list(self.registry.keys())

    def menu_choices(self):
        return ["auto"] + self.model_ids

    def set_current(self, choice):
        if choice != "auto" and choice not in self.registry:
            raise ValueError(f"unknown model: {choice}")
        self.current = choice

    def spec_for(self, spec_id):
        return self.registry[spec_id]

    def resolve(self, message):
        """Return the ModelSpec to use for this message."""
        if self.current != "auto":
            return self.registry[self.current]
        spec_id = self.router.resolve(message)
        if spec_id is None or spec_id not in self.registry:
            # absolute fallback: first registered model
            spec_id = self.model_ids[0]
        return self.registry[spec_id]

    # -- config mutation used by Settings ---------------------------------
    def add_cloud_model(self, model_name, route="general"):
        model_name = model_name.strip()
        if not model_name:
            raise ValueError("empty model name")
        llm = self.cfg.setdefault("llm", {})
        key = "cloud_coding_models" if route == "coding" else "cloud_models"
        existing = llm.get(key)
        if not isinstance(existing, list):
            existing = [p.strip() for p in str(existing or "").split(",") if p.strip()]
        if model_name not in existing:
            existing.append(model_name)
        llm[key] = existing
        providers.save_config(self.cfg)
        self.reload(self.cfg)
        return f"cloud/{model_name}"

    def set_auto_route(self, alias, spec_id):
        if alias not in ("general", "coding"):
            raise ValueError(f"bad route alias: {alias}")
        if spec_id not in self.registry:
            raise ValueError(f"unknown model id: {spec_id}")
        jarvis = self.cfg.setdefault("jarvis", {})
        jarvis["general_model" if alias == "general" else "coding_model"] = spec_id
        providers.save_config(self.cfg)
        self.reload(self.cfg)


# ---------------------------------------------------------------------------
# Command handlers (pure: return text/actions, no GUI)
# ---------------------------------------------------------------------------


class CommandResult:
    """What the GUI should do after a handled command."""

    def __init__(self, kind, text="", speak_text=None, action=None):
        self.kind = kind            # "chat" | "error" | "system" | "action"
        self.text = text
        self.speak_text = speak_text
        self.action = action        # e.g. ("confirm", "shutdown") or ("export", ...)

    def __repr__(self):
        return f"CommandResult({self.kind!r}, {self.text!r}, action={self.action!r})"


def cmd_remember(mem, arg):
    if "=" not in arg:
        return CommandResult("error", "Jarvis: Use format remember key=value\n\n")
    key, value = arg.split("=", 1)
    key, value = key.strip(), value.strip()
    mem[key] = value
    return CommandResult("chat", f"Jarvis: Saved memory -> {key} = {value}\n\n")


def cmd_recall(mem, key):
    key = key.strip()
    if key in mem:
        return CommandResult("chat", f"Jarvis: {key} = {mem[key]}\n\n")
    return CommandResult("error", "Jarvis: I don't know that yet.\n\n")


def cmd_forget(mem, key):
    key = key.strip()
    if key in mem:
        del mem[key]
        return CommandResult("chat", f"Jarvis: Forgot {key}.\n\n")
    return CommandResult("error", "Jarvis: I don't know that memory.\n\n")


def cmd_show_memory(mem):
    if not mem.data:
        return CommandResult("error", "Jarvis: Memory is empty.\n\n")
    body = "\n".join(f"{k} = {v}" for k, v in mem.items())
    return CommandResult("chat", f"Jarvis Memory:\n{body}\n\n")


def cmd_time():
    now = datetime.now().strftime("%I:%M %p")
    return CommandResult("chat", f"Jarvis: The current time is {now}\n\n",
                         speak_text=f"The current time is {now}")


def cmd_date():
    today = datetime.now().strftime("%d %B %Y")
    return CommandResult("chat", f"Jarvis: Today's date is {today}\n\n",
                         speak_text=f"Today's date is {today}")


def cmd_battery(psutil_mod=None):
    """Battery + CPU/RAM snapshot. psutil is injectable for tests."""
    psutil_mod = psutil_mod or _try_import("psutil")
    if psutil_mod is None:
        return CommandResult("error", "Jarvis: psutil isn't available.\n\n")
    parts = []
    try:
        batt = psutil_mod.sensors_battery()
        if batt is None:
            parts.append("Battery: not detected (desktop?)")
        else:
            pct = round(batt.percent)
            state = "charging" if batt.power_plugged else "on battery"
            parts.append(f"Battery: {pct}% ({state})")
    except Exception as e:
        parts.append(f"Battery: unavailable ({e})")
    try:
        parts.append(f"CPU: {psutil_mod.cpu_percent(interval=0.3):.0f}%")
    except Exception:
        pass
    try:
        vm = psutil_mod.virtual_memory()
        used = providers.format_bytes(vm.total - vm.available)
        parts.append(f"RAM: {used} / {providers.format_bytes(vm.total)} ({vm.percent}%)")
    except Exception:
        pass
    text = "Jarvis: " + "  |  ".join(parts) + "\n\n"
    return CommandResult("chat", text, speak_text=". ".join(parts))


def _try_import(name):
    try:
        return __import__(name)
    except Exception:
        return None
