# AGENTS.md — J.A.R.V.I.S Desktop Assistant

> Context for AI agents working on this repo. Updated as we code — check the "Changelog / Living Notes" section at the bottom for the latest.

## What this project is

**J.A.R.V.I.S** is a personal, voice-enabled **desktop AI assistant for Windows**, powered by **local LLMs via [Ollama](https://ollama.com)**. It has a dark, Iron-Man-styled GUI built with `customtkinter` and supports:

- **Streaming chat** with local models (token-by-token, stop/regenerate/copy support)
- **Voice input** (SpeechRecognition) and **voice output** (pyttsx3 TTS, mute toggle)
- **Vision**: analyze screenshots or any image file with a vision model
- **Persistent memory** (`remember key=value` → `memory.json`)
- **Persistent chat history** (`chat_history.json`, replayed on launch)
- **App/website launching** (VS Code, Edge, YouTube, GitHub, ChatGPT)
- **System commands** (time/date, shutdown/restart with confirmation)
- **Auto model routing**: picks a small fast model or a bigger coder model based on message content, sticky across a coding conversation
- Packaged as a standalone **`.exe`** via PyInstaller

## Main files

| File | Purpose |
|---|---|
| `jarvis_gui.py` | **Main application** (~1070 lines). The GUI app — this is what you edit. |
| `jarvis_gui.pyw` | Same code, `.pyw` extension = runs without a console window (for shortcut option). |
| `jarvis.py` | Older, simple CLI version (terminal-only, basic memory + a couple app commands). Largely superseded by the GUI. |
| `config.toml` | **⚠️ Contains an API key** for an LLM router (`openai/kimi/kimi-k3` via orcarouter). Note: `jarvis_gui.py` currently uses local Ollama, not this config — the config appears to be for aider or a future feature. Do not commit changes that expose or modify this key. |
| `build_exe.bat` | Builds `dist\JARVIS.exe` with PyInstaller (onefile, windowed, custom icon). |
| `jarvis_gui.spec` | PyInstaller spec (basic, windowed, no console). |
| `DESKTOP_APP_SETUP.md` | Docs for turning it into a clickable desktop app (exe vs shortcut). |
| `memory.json` | Runtime key=value memory store (gitignored). |
| `chat_history.json` | Runtime chat log (gitignored). |
| `jarvis.log` | Runtime action log (gitignored). |
| `assets/jarvis_circle.png` | Avatar image; code falls back gracefully if missing. |
| `current_screen.png` | Temp screenshot written on screenshot analysis. |

## Tech stack & dependencies

Python 3, Windows-first (with partial cross-platform handling in `run_shutdown_action` / `open_edge`).

```
pip install customtkinter ollama pillow pyttsx3 SpeechRecognition pyautogui psutil pyaudio
```

- **`ollama`** — local LLM server; app expects `ollama serve` running + models pulled.
- **`customtkinter`** + **PIL** — GUI.
- **`pyttsx3`** — TTS (runs on a worker thread via a queue).
- **`SpeechRecognition`** + **pyaudio** — mic input (threaded so it doesn't freeze the UI).
- **`pyautogui`** — screenshots. **`psutil`** — process/system checks.

### Models (defined in `AVAILABLE_MODELS`, `jarvis_gui.py`)

```python
AVAILABLE_MODELS = ["auto", "qwen2.5:3b", "qwen2.5-coder:7b"]
```

- `auto` mode routes between the small and coder model using `CODING_KEYWORDS`, and is **sticky** (won't thrash between models mid-conversation — that was a past perf bug).
- Vision model is referenced separately for image analysis.
- `keep_alive` is explicitly set (~30 min) so models aren't evicted after Ollama's default 5-min idle.

## Architecture notes (important — read before editing `jarvis_gui.py`)

- **Single-file app**, organized in sections with banner comments (`# ====...====`): paths/persistence, TTS, avatar, nav, chat rendering, model logic, streaming, vision, voice, command handling, panels, boot.
- **Threading rules**: all GUI updates from worker threads (AI reply, vision, TTS) **must** go through `app.after(...)` — touching Tkinter widgets directly from a thread is not thread-safe (this was a past bug).
- **Command dispatch**: the old ~40-branch if/elif chain was refactored into tables:
  - `SIMPLE_COMMANDS` — exact-match commands → handler functions
  - `APP_COMMANDS` — `"open x"` → (message, function)
  - `WEBSITE_COMMANDS` — `"open x"` → URL
  - Plus handlers: `handle_memory_commands`, `handle_pending_confirmation` (shutdown/restart yes/no), `handle_app_or_website`.
  - **To add a new command, add one entry to the right table — don't write a new if-branch.**
- **Overlap guards**: a second message can't be sent while a reply is streaming; a second image can't be analyzed while one is in flight. Respect these guards.
- **Perf caps**: `MAX_HISTORY_MESSAGES = 200` (persisted), `MAX_CONTEXT_MESSAGES = 6` (sent to Ollama per turn), `MAX_CHATBOX_LINES = 800` (visible log trimmed).
- **Streaming**: replies use `ollama.chat(stream=True)`; the send button becomes a Stop button mid-stream. Fenced ``` code blocks render in monospace/highlighted live.
- **Persistence files** (`memory.json`, `chat_history.json`, `jarvis.log`) are created next to wherever the app runs — for the built exe, that's the exe's folder.

## Building / running

```powershell
# Run from source (needs Ollama running + models pulled)
python jarvis_gui.py

# Build the standalone exe
.\build_exe.bat        # output: dist\JARVIS.exe
```

Setup a model before first run, e.g. `ollama pull qwen2.5:3b`.

## Conventions & gotchas

- **Git**: single initial commit; no remote/PR workflow in use. Runtime files and venvs are gitignored.
- **Venvs**: two local env folders exist (`jarvis-env/`, `win-venv/`) — both gitignored; don't add code there.
- The terminal's default Python on this machine is an MSYS2 mingw Python, **not** necessarily the one with the deps installed — use the project venv if imports fail.
- **⚠️ Security**: `config.toml` holds a live API key and is committed to git. Never print, exfiltrate, or modify it; consider scrubbing it from history if the repo is ever made public.
- `jarvis.py` (CLI) has known bugs (a `forget` block that falls through, `continue` statements that short-circuit the loop) — it's legacy; prefer fixing in the GUI app unless the user says otherwise.
- Docstring at the top of `jarvis_gui.py` contains a detailed change history — it's the best in-code record of why things are the way they are.

## Changelog / Living Notes

- **2026-08-14** — `AGENTS.md` created. Project identified as Ollama-powered customtkinter desktop assistant; main file is `jarvis_gui.py` (~1070 lines); legacy CLI `jarvis.py` still present.
