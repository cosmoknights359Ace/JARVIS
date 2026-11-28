# J.A.R.V.I.S. — Local-First Personal AI Desktop Workstation

> **Just A Rather Very Intelligent System** — A private, local-first AI desktop workstation powered by **[Ollama](https://ollama.com)**, featuring an engine-reactive animated HUD, smart model routing, hardware-aware VRAM tiering, **Xfill** document automation, **Xslide** PowerPoint generation, and **Xconvert** universal local file conversion.

<!-- Tip: Replace this with your actual screenshot or demo GIF once uploaded to GitHub -->
<!-- ![J.A.R.V.I.S. Desktop UI](assets/jarvis_preview.png) -->

---

## Table of Contents
- [Core Features](#core-features)
- [Prerequisites](#prerequisites)
- [Installation Guide](#installation-guide)
- [Running as a Native Desktop App (Windows)](#running-as-a-native-desktop-app-windows)
- [Feature Walkthrough](#feature-walkthrough)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Troubleshooting](#troubleshooting)
- [Tech Stack](#tech-stack)
- [License & Creator Attribution](#license--creator-attribution)

---

## Core Features

### Local-First Desktop Architecture
- **Native Desktop Shell (`pywebview`):** Runs as a standalone **Obsidian & Orange** desktop application with Windows System Tray (`pystray`) minimize-to-tray support and a silent desktop shortcut launcher (`Launch_JARVIS.vbs`)—no browser tabs or flashing console windows.
- **100% Offline Primary Engine:** Connects directly to your local Ollama server (`http://localhost:11434`) with zero API keys required. Optional Gemini Cloud fallback is supported only if Ollama is offline and `GEMINI_API_KEY` is configured.
- **Hardware-Aware VRAM Tiering:** Automatically detects your GPU VRAM and system RAM (e.g., *Entry GPU · 4GB VRAM*) to badge models as `Optimal`, `Heavy`, or `Too Heavy` and tune context limits safely.
- **Zero-Terminal Model Manager:** Pull, monitor download progress, and delete Ollama models directly inside the app without opening a terminal.

### Assistant — Streaming Chat, Routing & HUD
- **Engine-Reactive Animated HUD Core:** Concentric rotating SVG HUD that visually reflects live engine status (`Offline` standby, `Online` cyan glow, and `Thinking` accelerated spin).
- **Sticky Auto-Routing:** Automatically switches between your fast general model (`qwen2.5:3b`) and coding model (`qwen2.5-coder:7b`) when programming topics are detected, staying sticky across coding threads to avoid unnecessary model swaps.
- **Real-Time Streaming & Controls:** Server-Sent Events (SSE) streaming with Stop, Edit, Regenerate, Copy, syntax-highlighted code blocks, and one-click starter prompt chips.
- **Persistent Memory Bank & Local Commands:** Store facts (`remember key=value`, `recall key`, `forget key`) injected directly into prompts, plus instant commands (`/status`, `/calc`, `/code`, `/clear`, `/export`).
- **Voice Input (STT) & Speech Output (TTS):** Hands-free dictation and speech synthesis with mute toggle, voice/rate tuning, and automatic code-block stripping.
- **Live Engine Diagnostics:** Real-time Ollama probe ping (`ms`), VRAM readiness, Time-to-First-Token (TTFT), and streaming throughput (`tok/s`).

### Xfill — Grounded Document Auto-Fill (`.docx`, `.xlsx`, `.pptx`)
- Deterministically parses Office XML/workbooks to detect template tags (`{{...}}`), inline blanks (`____`), labelled fields (`Answer:`, `Name:`), Q&A pairs, and empty spreadsheet/table cells without letting the LLM break document layout.
- Low-hallucination grounded solver (`temperature: 0.1`, JSON-constrained) prioritizes **Memory Bank → Context Notes → Verified Knowledge**, flagging unknown private fields as `[NEEDS INPUT]` instead of fabricating personal info.
- Review, edit inline, regenerate individual fields, save answers to Memory, and export the completed `.docx`, `.xlsx`, or `.pptx` with original styling preserved.

### Xslide — Local PowerPoint (`.pptx`) Generator
- Generates structured 16:9 presentations (5–12 slides) with multiple layouts (*Title Hero*, *Split + Image*, *Bullets*, *Two Column*, *Key Metric*, *Table*) and presenter Speaker Notes.
- 4 Visual Theme Presets (*Obsidian & Orange*, *Editorial Ivory*, *Slate Executive*, *Emerald Tech*) with a live 16:9 preview canvas.
- **Consent-Gated Web Images:** Outbound image search is locked off by default (enforced in UI and server HTTP 403 guard). Once approved, browse and embed royalty-free visuals from Wikimedia Commons & Openverse using only 2–5 word visual keywords.

### Xconvert — Universal Local File Converter
- Local disk-to-disk batch conversion with **zero upload or file-size limits**:
  - **Documents:** `.docx`, `.pdf`, `.md`, `.html`, `.txt`
  - **Images:** `.png`, `.jpg`, `.webp`, `.ico` (with automatic `RGBA → RGB` handling)
  - **Data:** `.csv`, `.xlsx`, `.json`, `.yaml`
  - **Media & Archives:** `.mp4` → `.mp3` / `.gif` (via headless `ffmpeg`), `.zip` / `.7z`
- Includes batch "Set All To..." format selection, custom output folder picker, missing-engine detection hints, and 1-click **Open in Explorer**.

---

## Prerequisites

| Requirement | Minimum | Recommended |
| :--- | :--- | :--- |
| **Operating System** | Windows 10/11, macOS 13+, or Linux | Windows 11 (64-bit) |
| **Node.js** | v20.0+ | v20 LTS / v22 LTS |
| **Python** | 3.10+ (for Desktop Shell & Xconvert) | 3.11+ |
| **Ollama** | Latest release | Latest release |
| **RAM / VRAM** | 8 GB RAM (`qwen2.5:3b`) | 16 GB RAM + 4 GB+ VRAM (`qwen2.5-coder:7b`) |
| **Disk Space** | ~3 GB free | ~10 GB free (for multiple local models) |

---

## Installation Guide

### 1. Install Ollama
Download and install Ollama from [ollama.com/download](https://ollama.com/download) (or on Linux: `curl -fsSL https://ollama.com/install.sh | sh`).

Verify installation:
```bash
ollama --version
```

### 2. Pull Local AI Models
Pull the recommended models used by J.A.R.V.I.S.'s sticky auto-router (or install them later inside the app via **Manage Models**):

```bash
# Fast general assistant, Xfill solver, and Xslide generator (~1.9 GB)
ollama pull qwen2.5:3b

# Dedicated coding & technical reasoning model (~4.7 GB)
ollama pull qwen2.5-coder:7b
```

#### Optional: Custom Fine-Tuned `vai-doc:latest` Model (Xfill & Xslide)
J.A.R.V.I.S. routes **Xfill** and **Xslide** to `vai-doc:latest` by default (automatically falling back to installed models such as `qwen2.5:3b` if `vai-doc:latest` is not installed). To register a local quantized `vai-doc.gguf` model:

1. Place `vai-doc.gguf` inside the `models/` directory (`*.gguf` files are gitignored).
2. Create the Ollama model using the bundled Modelfile:
   ```bash
   ollama create vai-doc:latest -f models/Modelfile.vai-doc
   ```

*(Optional — for local image/vision analysis)*:
```bash
ollama pull llama3.2-vision:latest
```

Make sure the Ollama service is running (`ollama serve` if not auto-started by the Ollama tray app).

### 3. Clone & Install Dependencies

```bash
# Clone the repository
git clone https://github.com/cosmoknight/JARVIS.git
cd JARVIS

# Install Node.js frontend & server dependencies
npm install
```

*(Optional — for Native Desktop Shell, System Tray, and Xconvert engines)*:
```bash
# Core desktop window & Windows system tray
pip install pywebview pystray Pillow

# Optional Xconvert document, data, archive, and media engines
pip install img2pdf PyMuPDF python-docx pdf2docx pandas openpyxl PyYAML imageio-ffmpeg py7zr markdown
```

### 4. Optional Cloud Fallback (`.env`)
J.A.R.V.I.S. runs **100% locally with Ollama** and requires no API keys. To enable automatic Gemini Cloud fallback when Ollama is stopped:

```bash
cp .env.example .env
```

Set your key in `.env`:
```env
GEMINI_API_KEY=your_api_key_here
```

### 5. Start in Web Mode (Any OS)

```bash
# Development mode (Express + Vite middleware on port 3000)
npm run dev

# Production build & start
npm run build
npm start
```

Open `http://localhost:3000` in your browser.

---

## Running as a Native Desktop App (Windows)

### Launch Directly via `pywebview`
Build the frontend once (optional—`jarvis_gui.py` auto-selects `dist/` or Vite dev mode) and start the native desktop window:

```bash
npm run build
python jarvis_gui.py
```

Useful launcher flags:
- `python jarvis_gui.py --prod` — run compiled `dist/` build (auto-builds if missing)
- `python jarvis_gui.py --dev` — force Vite dev middleware mode
- `python jarvis_gui.py --debug` — enable WebView DevTools

### System Tray & Minimize-to-Tray
When `pystray` and `Pillow` are installed:
- Clicking the window **`X`** button minimizes J.A.R.V.I.S. silently to the Windows System Tray instead of killing the local backend.
- Right-click (or click) the tray icon to **Show / Hide JARVIS** or **Quit JARVIS** (which cleanly terminates the local Node.js subprocess tree with zero orphan processes).

### One-Click Silent Windows Desktop Shortcut
Create a console-free Desktop shortcut (`JARVIS.lnk`) backed by `Launch_JARVIS.vbs`:

```bash
python create_shortcut.py
```

Double-clicking **JARVIS** on your Desktop launches `jarvis_gui.py` silently via `pythonw.exe` with **zero flashing black terminal window**.

---

## Feature Walkthrough

### Assistant (Chat, Routing, HUD & Model Manager)
- **Welcome HUD & Starter Prompts:** On a fresh session, the animated HUD core mirrors live engine status (`Offline`, `Online`, `Thinking`) above four one-click starter prompt chips (*Debug & Fix Code*, *Explain Simply*, *Quick Script*, *Use My Memory*).
- **Zero-Terminal Model Manager:** Open **Manage Models** from the sidebar or model selector dropdown to view installed models, install recommended hardware-badged models with a live progress bar, pull any custom Ollama tag, or remove unused models.
- **Persistent Memory & Instant Commands:**
  - `remember company=Acme Labs` / `recall company` / `forget company` / `show memory`
  - `/status` — live provider status, probe latency, and model route
  - `/calc (256 * 16) + 1024` — instant local calculation
  - `/code <prompt>` — force routing to your coding model
  - `/clear` or `/export` — clear screen or export conversation as `.md`

### Xfill (Grounded Document Auto-Fill)
1. Open the **`Xfill`** tab in the top navigation bar.
2. Upload any `.docx`, `.xlsx`, or `.pptx` file (or test immediately with the built-in sample documents).
3. *(Optional)* Add **Context Notes**, pick an answer style (*Concise*, *Detailed*, *Bullets*), or enable **Strict Context-Only Mode**.
4. Click **Auto-Fill Detected Fields**—unknown private fields are flagged `[NEEDS INPUT]` instead of hallucinated.
5. Edit answers inline, save facts to Memory, and click **Export Updated File** with original formatting intact.

### Xslide (Local PowerPoint Generator)
1. Open the **`Xslide`** tab in the top navigation bar.
2. Enter a topic, slide count (`5`–`12`), tone, optional context notes, and choose one of the **4 Visual Theme Presets**.
3. Click **Generate Deck** to draft structured slides, native tables, and presenter **Speaker Notes**.
4. *(Optional)* Approve **Allow Web Images** to browse and embed royalty-free Wikimedia Commons / Openverse visuals per slide.
5. Fine-tune slides on the live 16:9 canvas and click **Export `.pptx`**.

### Xconvert (Universal Local File Converter)
1. Open the **`Xconvert`** tab in the top navigation bar.
2. Drop or pick local files (or folders) across documents, images, spreadsheets/data, media, and archives.
3. Select per-file target formats or use **Set All To...**, pick a custom output folder if desired, and click **Convert All**.
4. Click **Open in Explorer** to jump straight to the converted files on disk.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Enter` | Send message in Assistant |
| `Shift + Enter` | Insert newline in composer |
| `↑` / `↓` | Cycle previous prompt history |
| `Ctrl / Cmd + K` | Open Commands & Guide modal |
| `Ctrl / Cmd + L` | Clear active conversation view |
| `Ctrl / Cmd + E` | Export active conversation as Markdown (`.md`) |
| `Ctrl / Cmd + M` | Toggle TTS voice synthesis mute |
| `Esc` | Close active modal / drawer |

---

## Troubleshooting

- **Ollama shows as Offline**
  - Click **Retry Connection** on the in-app recovery banner or **Probe** in Engine Diagnostics, and verify Ollama is running at `http://localhost:11434/api/tags` (or start it with `ollama serve`).
  - If Ollama runs on another port or LAN host, update **Ollama Host URL** in **Settings**.
- **First reply feels slow**
  - Ollama loads model weights into RAM/VRAM on the first turn. J.A.R.V.I.S. automatically pre-warms your model and sends `keep_alive: 30m` (configurable in **Settings**) so follow-up turns stay fast.
- **Model not found**
  - Open **Manage Models** inside J.A.R.V.I.S. (or run `ollama list` / `ollama pull qwen2.5:3b`) to install the missing tag.
- **Xconvert reports a missing engine**
  - Xconvert detects available Python libraries automatically and shows the exact `pip install ...` command for any optional format engine (such as `PyMuPDF`, `pdf2docx`, or `imageio-ffmpeg`).
- **Build fails with `[COPYRIGHT INTEGRITY CHECK FAILED]`**
  - Run `npm run verify:copyright` to see which attribution file (`LICENSE`, `NOTICE`, `src/services/attribution.ts`, `server.ts`, or agent policy files) was altered. Original creator attribution must remain intact per the license.

---

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite 6, Tailwind CSS v4, Lucide Icons, Orbitron / Outfit / Plus Jakarta Sans / JetBrains Mono
- **Backend:** Node.js, Express 5 (`tsx`)
- **Native Desktop & Local Converters:** Python 3, `pywebview`, `pystray`, `Pillow`, `xconvert_engine.py`
- **Local AI & Optional Cloud:** Ollama REST API (`/api/chat`, `/api/tags`, `/api/pull`, `/api/delete`), `@google/genai` (optional server-side fallback)
- **Document & Presentation Engines:** `jszip`, `exceljs`, `pptxgenjs`

---

## License & Creator Attribution

**MIT License — with Mandatory Creator Attribution.**

Copyright (c) 2026 **cosmoknight** (`J.A.R.V.I.S (c) 2026 cosmoknight` · Seal `ceff726d5d41618b`).

You are free to use, study, modify, and redistribute this software, provided the original creator credit **"J.A.R.V.I.S — (c) 2026 cosmoknight"** is retained in the software, its documentation (`LICENSE` and `NOTICE`), and any redistributed or derivative copies. Removing, obscuring, or bypassing creator attribution is not permitted.

See [LICENSE](LICENSE) and [NOTICE](NOTICE) for full terms.
