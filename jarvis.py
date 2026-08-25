#!/usr/bin/env python3
"""
J.A.R.V.I.S — terminal edition
==============================
The same assistant as jarvis_gui.py, but running entirely in your terminal.
No GUI dependencies needed — just the `ollama` package and a running
Ollama server with the models pulled.

Setup:
    pip install ollama
    ollama pull qwen2.5:3b
    ollama pull qwen2.5-coder:7b

Run:
    python jarvis.py

Shares memory.json and chat_history.json with the GUI app, so memory and
history carry over between the two. Features: streaming replies, sticky
auto model routing (3b chat / 7b coder), persistent memory, chat history,
web search / app launching / time / date commands, and terminal-native
input history (arrow keys work out of the box via readline).
"""

import json
import os
import platform
import sys
import threading
import time
import webbrowser
from datetime import datetime
from urllib.parse import quote_plus

try:
    import readline  # noqa: F401 — gives input() arrow-key history on its own
except ImportError:
    pass  # Windows: history still works via pip install pyreadline3

import ollama

MEMORY_FILE = "memory.json"
HISTORY_FILE = "chat_history.json"

MAX_HISTORY_MESSAGES = 200   # messages kept on disk
MAX_CONTEXT_MESSAGES = 6     # messages sent to Ollama per turn
KEEP_ALIVE = "30m"

AVAILABLE_MODELS = ["auto", "qwen2.5:3b", "qwen2.5-coder:7b"]
CODING_KEYWORDS = [
    "code", "python", "java", "c++", "javascript", "html", "css",
    "program", "script", "leetcode", "bug", "error", "debug",
]

CYAN, GREEN, AMBER, RED, DIM, RESET = (
    "\033[96m", "\033[92m", "\033[93m", "\033[91m", "\033[90m", "\033[0m"
)
if platform.system() == "Windows":
    os.system("")  # enable ANSI colors on modern Windows terminals


def load_json(path, default):
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path, data):
    try:
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
    except OSError as e:
        print(f"{RED}Couldn't save {path}: {e}{RESET}")


memory = load_json(MEMORY_FILE, {})
history = load_json(HISTORY_FILE, [])[-MAX_HISTORY_MESSAGES:]

current_model = "auto"
_last_resolved_model = None
_consecutive_non_coding = 0
STICKY_NON_CODING_THRESHOLD = 3


def resolve_model(message):
    """Same sticky auto-routing as the GUI: coding messages switch to the 7b
    coder model and stay there through the follow-ups instead of bouncing
    between models (every switch forces a multi-second reload from disk)."""
    global _last_resolved_model, _consecutive_non_coding
    if current_model != "auto":
        return current_model
    if any(word in message.lower() for word in CODING_KEYWORDS):
        _consecutive_non_coding = 0
        _last_resolved_model = "qwen2.5-coder:7b"
    else:
        _consecutive_non_coding += 1
        if (_last_resolved_model is None
                or _consecutive_non_coding >= STICKY_NON_CODING_THRESHOLD):
            _last_resolved_model = "qwen2.5:3b"
    return _last_resolved_model


def check_models():
    """Warn up front if a configured model hasn't been pulled yet."""
    try:
        installed = {m.get("model") or m.get("name")
                     for m in ollama.list().get("models", [])}
    except Exception as e:
        print(f"{RED}Can't reach the Ollama server: {e}{RESET}")
        print("Is `ollama serve` running?\n")
        return
    missing = [
        m for m in AVAILABLE_MODELS
        if m != "auto"
        and not any(m == i or i.startswith(m.split(":")[0] + ":") for i in installed)
    ]
    if missing:
        print(f"{AMBER}Not pulled yet: {', '.join(missing)}"
              f"  (run `ollama pull <model>`){RESET}\n")


def warm_models():
    """Load the text models in the background so the first real message
    doesn't pay the full cold-load cost."""
    try:
        installed = {m.get("model") or m.get("name")
                     for m in ollama.list().get("models", [])}
    except Exception:
        return
    for model_name in AVAILABLE_MODELS[1:]:
        if not any(model_name == i or i.startswith(model_name) for i in installed):
            continue
        try:
            ollama.chat(model=model_name,
                        messages=[{"role": "user", "content": "hi"}],
                        keep_alive=KEEP_ALIVE, options={"num_predict": 1})
        except Exception:
            pass


def stream_reply(message):
    """Streams the reply token-by-token; Ctrl+C mid-stream cancels the
    answer but keeps the session alive."""
    memory_text = "\n".join(f"{k}: {v}" for k, v in memory.items())
    system_message = {
        "role": "system",
        "content": f"You are Jarvis, a concise personal AI assistant.\n\n"
                   f"User memory:\n{memory_text}\n\nAnswer concisely.",
    }
    model_name = resolve_model(message)
    history.append({"role": "user", "content": message})

    print(f"{DIM}── jarvis · {datetime.now():%H:%M} · {model_name} ──{RESET}")
    print(GREEN, end="", flush=True)
    reply_parts = []
    start_t = time.monotonic()
    eval_count = eval_duration = None
    stopped = False
    try:
        stream = ollama.chat(
            model=model_name,
            messages=[system_message] + history[-MAX_CONTEXT_MESSAGES:],
            stream=True,
            keep_alive=KEEP_ALIVE,
        )
        for part in stream:
            piece = part.get("message", {}).get("content", "")
            if piece:
                reply_parts.append(piece)
                print(piece, end="", flush=True)
            if part.get("done"):
                eval_count = part.get("eval_count")
                eval_duration = part.get("eval_duration")
    except KeyboardInterrupt:
        stopped = True
    except Exception as e:
        print(f"{RESET}\n{RED}Couldn't reach Ollama ({model_name}). "
              f"Is `ollama serve` running?\n{e}{RESET}\n")
        return
    finally:
        print(RESET)

    reply = "".join(reply_parts)
    if reply.strip():
        history.append({"role": "assistant", "content": reply})
        save_json(HISTORY_FILE, history[-MAX_HISTORY_MESSAGES:])

    elapsed = time.monotonic() - start_t
    if stopped:
        print(f"{DIM}(stopped · {elapsed:.1f}s){RESET}\n")
    elif eval_count and eval_duration:
        tok_s = eval_count / (eval_duration / 1e9)
        print(f"{DIM}({elapsed:.1f}s · {tok_s:.0f} tok/s · "
              f"{model_name}){RESET}\n")
    else:
        print(f"{DIM}({elapsed:.1f}s · {model_name}){RESET}\n")


HELP_TEXT = f"""{AMBER}
Jarvis terminal commands:

  remember key=value     save something to memory
  recall <key>           read it back
  forget <key>           delete it
  show memory            list everything remembered

  model                  show current model
  model <name|auto>      switch model (e.g. model qwen2.5:3b)
  new chat               clear the conversation (screen + context + history)
  export chat            save the conversation to a .md file

  search <query>         open a Google search in your browser
  open <site>            youtube / github / chatgpt
  what time is it        current time
  whats todays date      today's date

  help                   this text
  exit / quit            leave (Ctrl+C also works)

Anything else is sent to the model. "auto" routes coding questions to
qwen2.5-coder:7b and everything else to qwen2.5:3b. Arrow keys recall
previous inputs. Ctrl+C while Jarvis is typing cancels that answer only.
{RESET}"""

WEBSITE_COMMANDS = {
    "open youtube": "https://youtube.com",
    "open github": "https://github.com",
    "open chatgpt": "https://chatgpt.com",
}


def handle_command(message):
    """Returns True if the message was a command (already handled)."""
    global current_model
    lower = message.lower()

    if lower in ("help", "?"):
        print(HELP_TEXT)
        return True

    if lower == "model":
        print(f"{CYAN}Model: {current_model}"
              + (f" (auto → {_last_resolved_model})"
                 if current_model == "auto" and _last_resolved_model else "")
              + f"{RESET}\n")
        return True
    if lower.startswith("model "):
        choice = lower[6:].strip()
        if choice in AVAILABLE_MODELS:
            current_model = choice
            print(f"{CYAN}Model set to {choice}{RESET}\n")
        else:
            print(f"{RED}Unknown model. Available: "
                  f"{', '.join(AVAILABLE_MODELS)}{RESET}\n")
        return True

    if lower.startswith("remember "):
        info = message[9:]
        if "=" in info:
            key, value = info.split("=", 1)
            memory[key.strip()] = value.strip()
            save_json(MEMORY_FILE, memory)
            print(f"{CYAN}Saved: {key.strip()} = {value.strip()}{RESET}\n")
        else:
            print(f"{RED}Use format: remember key=value{RESET}\n")
        return True
    if lower.startswith("recall "):
        key = message[7:].strip()
        print(f"{CYAN}{key} = {memory[key]}{RESET}\n" if key in memory
              else f"{RED}I don't know that yet.{RESET}\n")
        return True
    if lower.startswith("forget "):
        key = message[7:].strip()
        if key in memory:
            del memory[key]
            save_json(MEMORY_FILE, memory)
            print(f"{CYAN}Forgot {key}.{RESET}\n")
        else:
            print(f"{RED}I don't know that memory.{RESET}\n")
        return True
    if lower == "show memory":
        if memory:
            for k, v in memory.items():
                print(f"{CYAN}{k} = {v}{RESET}")
        else:
            print(f"{RED}Memory is empty.{RESET}")
        print()
        return True

    if lower in ("new chat", "clear history"):
        history.clear()
        save_json(HISTORY_FILE, history)
        os.system("cls" if platform.system() == "Windows" else "clear")
        print(f"{AMBER}── new conversation ──{RESET}\n")
        return True
    if lower == "export chat":
        path = f"jarvis_chat_{datetime.now():%Y%m%d_%H%M%S}.md"
        lines = []
        for msg in history:
            speaker = "**You**" if msg.get("role") == "user" else "**Jarvis**"
            lines.append(f"{speaker}: {msg.get('content', '')}")
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write("\n\n".join(lines))
            print(f"{CYAN}Exported to {os.path.abspath(path)}{RESET}\n")
        except OSError as e:
            print(f"{RED}Couldn't export: {e}{RESET}\n")
        return True

    if lower.startswith("search "):
        query = message[7:].strip()
        if query:
            webbrowser.open(f"https://www.google.com/search?q={quote_plus(query)}")
            print(f"{CYAN}Searching the web for: {query}{RESET}\n")
        else:
            print(f"{RED}Search for what? (search <query>){RESET}\n")
        return True
    if lower in WEBSITE_COMMANDS:
        webbrowser.open(WEBSITE_COMMANDS[lower])
        print(f"{CYAN}Opening {lower.split(' ', 1)[1]}...{RESET}\n")
        return True

    if lower == "what time is it":
        print(f"{CYAN}The current time is {datetime.now():%I:%M %p}{RESET}\n")
        return True
    if lower in ("whats todays date", "what is todays date",
                 "what's today's date", "what is today's date"):
        print(f"{CYAN}Today's date is {datetime.now():%d %B %Y}{RESET}\n")
        return True

    return False


def main():
    print(f"""{CYAN}
     ╔══════════════════════════════════╗
       J.A.R.V.I.S — terminal edition
     ╚══════════════════════════════════╝{RESET}""")
    check_models()
    threading.Thread(target=warm_models, daemon=True).start()
    print(f"{DIM}Type 'help' for commands, 'exit' to quit.{RESET}\n")

    while True:
        try:
            message = input(f"{GREEN}you > {RESET}").strip()
        except (EOFError, KeyboardInterrupt):
            print(f"\n{CYAN}Jarvis: Goodbye!{RESET}")
            break
        if not message:
            continue
        if message.lower() in ("exit", "quit"):
            print(f"{CYAN}Jarvis: Goodbye!{RESET}")
            break
        if handle_command(message):
            continue
        stream_reply(message)


if __name__ == "__main__":
    main()
