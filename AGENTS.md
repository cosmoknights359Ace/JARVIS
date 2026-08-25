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
| `jarvis_gui.py` | **Main application** (~1600 lines). The GUI app — this is what you edit. |
| `jarvis_gui.pyw` | Same code, `.pyw` extension = runs without a console window (for shortcut option). Keep byte-identical to `jarvis_gui.py`. |
| `jarvis.py` | **Terminal edition** (~340 lines): streaming chat, sticky auto routing, memory/history (shares `memory.json` / `chat_history.json` with the GUI), commands via `handle_command`. Run with `python jarvis.py`; only needs `ollama` (+ `pyreadline3` on Windows for arrow-key history). |
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
- The Settings model dropdown is populated dynamically from `ollama.list()` (falls back to the hardcoded list when the server is down); the vision model (`VISION_MODEL`, default `llama3.2-vision:latest`) is also editable in Settings.
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
- **Streaming**: replies use `ollama.chat(stream=True)`; the send button becomes a Stop button mid-stream. Fenced ``` code blocks render in monospace/highlighted live. Trailing backticks are held back at flush boundaries (`_split_holdback`) so a fence split across flushes doesn't lose highlighting.
- **TTS**: AI replies are spoken aloud via `_speakable()` (code blocks stripped, capped at 600 chars); `_tts_worker` degrades gracefully (disables TTS) if no audio driver exists.
- **Connectivity**: `_health_check_loop` pings `ollama.list()` every 15s; the status dot is green/red accordingly (it replaced the old cosmetic pulsing dot) and the pill shows ONLINE/OFFLINE + which model `auto` resolved to.
- **Input**: ↑/↓ cycles input history (`_input_history`); Ctrl+L/E/M/Q = clear screen / export / mute / quit; icon buttons have `ToolTip`s.
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
- **⚠️ Security**: `config.toml` holds a live API key. It is gitignored and NOT tracked in git (verified 2026-08-23). Never print, exfiltrate, or commit it; consider rotating the key since it lived in a plaintext local config.
- `jarvis.py` is the terminal edition — a full rewrite (2026-08-23) of the old buggy CLI, sharing persistence files with the GUI.
- Docstring at the top of `jarvis_gui.py` contains a detailed change history — it's the best in-code record of why things are the way they are.

## Changelog / Living Notes

- **2026-08-14** — `AGENTS.md` created. Project identified as Ollama-powered customtkinter desktop assistant; main file is `jarvis_gui.py` (~1070 lines); legacy CLI `jarvis.py` still present.
- **2026-08-23** — Usability pass on `jarvis_gui.py` (~1600 lines now): hover tooltips on all icon buttons; timestamped `YOU`/`JARVIS · model` message headers replacing ASCII boxes; real Ollama health check driving the status dot (green/red) + pill shows resolved auto model; AI replies actually spoken aloud (`_speakable`, code stripped); input history (↑/↓); Ctrl+L/E/M/Q shortcuts; new commands (`new chat`, `screenshot`/`analyze screen`, `search <q>`, `open notepad`, `open calculator`); Settings model dropdown from installed Ollama models + vision model field + voice switch synced to real state; first-run quick-start card; Home no longer wipes the chat; fixed ``` fence split across stream flushes (`_split_holdback`); TTS worker survives missing audio driver. `jarvis_gui.pyw` kept byte-identical to `jarvis_gui.py`. Verified headless (xvfb): boot, offline error path, health pill, commands, settings, tooltips.
- **2026-08-23 (GUI v3, Gemini-style redesign)** — Flat palette (`VOID #131314`), borderless look; sidebar = brand + `＋ New chat` pill + flat nav + "Recent" prompt list (click a prompt to re-send it) + Settings pinned at the bottom; banner/avatar removed; slim top strip (health pill + 🔊 toggle); pill input bar = `＋` attach menu (vision/regenerate/copy/export/help) + entry + model selector (synced with Settings via `set_current_model`) + 🎤 + ➤/■ send; centered "Ready when you are" greeting when the chat is empty. Bug fixes: bar/Settings model selector desync; user messages appended on the send path so Recent/history can't race the worker thread. `jarvis_gui.pyw` synced. Verified headless (xvfb): greeting toggles, model sync, recents race fix, attach menu, settings, offline pill all OK.
- **2026-08-23 (GUI v4, floating orb)** — Animated "arc-reactor" orb now lives in the centre of the empty chat instead of plain text (the text remains as a caption below). Code-drawn concentric glow arcs, pulsing core, parallax peek toward the cursor; thinking state expands/recolours the core (uses `_orb_state`). Verified headless (xvfb): show/hide + thinking toggles OK. `.pyw` synced.
- **2026-08-23 (GUI v5, HUD theme)** — Orb removed. Full amber/orange JARVIS HUD palette (angular borders). Empty chat = centered HUD panel "How can I help you, Sir?" + quick-action icons (Voice/Code/Browser/Terminal/Files/Notes/Calculator). Sidebar: "JUST A RATHER VERY INTELLIGENT SYSTEM" header, HUD nav rows with chevrons, live SYSTEM STATUS bars (CPU/RAM/NET via psutil), user card at bottom. Input bar amber angular + "JARVIS STATUS / ALL SYSTEMS OPERATIONAL" readout. Added `clear screen`/`clear chat` commands. Verified headless (xvfb). `.pyw` synced.
