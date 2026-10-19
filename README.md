# J.A.R.V.I.S — Web & Desktop AI Assistant (React + TypeScript)

**J.A.R.V.I.S** is a personal, voice-enabled AI assistant inspired by Tony Stark's iconic J.A.R.V.I.S HUD.
Rewritten as a high-performance **React + TypeScript SPA with Vite**, featuring real-time telemetry, model routing, speech synthesis & recognition, persistent memory, and vision analysis.

![JARVIS HUD](assets/jarvis_circle.png)

---

## Features

- **Streaming Chat** with token-by-token output, stop controls, regeneration, and copy functionality.
- **Voice Synthesizer (TTS)** using Web Speech API with automatic markdown and code fence stripping for natural spoken cadence.
- **Voice Dictation (STT)** with active microphone status indicator.
- **Vision Feed Analysis Matrix** — upload or analyze images and screen frames with neural object segmentation and OCR telemetry.
- **Persistent Key-Value Memory** (`remember key=value`, `recall key`, `forget key`, `show memory`) stored and persisted across sessions.
- **HUD Arc-Reactor Core Telemetry** — real-time CPU & RAM gauges, clock, and energy matrix visualization.
- **Sticky Model Routing** — automatically shifts between small conversational models (`qwen2.5:3b`) and coder models (`qwen2.5-coder:7b`) on coding keywords and maintains context stickiness.
- **System Commands & App Hub** — quick launch for VS Code, Edge, YouTube, GitHub, ChatGPT, Calculator, and system diagnostics with confirmation safety gates.
- **Attribution & Authenticity Verification** — integrity-guarded creator credit layer (`J.A.R.V.I.S (c) 2026 vinod`).

---

## Project Structure

```
├── assets/
│   └── jarvis_circle.png        # Arc Reactor HUD asset
├── src/
│   ├── components/
│   │   ├── ArcReactor.tsx       # SVG Arc Reactor core animation
│   │   ├── ChatView.tsx         # Main chat, code blocks, input history, commands
│   │   ├── HomeView.tsx         # System overview & tactical shortcuts
│   │   ├── MemoryView.tsx       # Interactive memory manager
│   │   ├── SettingsView.tsx     # Model routing & TTS preferences
│   │   ├── Sidebar.tsx          # Nav, recent chats, clearance card
│   │   ├── Topbar.tsx           # Status indicators, clock, audio toggle
│   │   └── VisionView.tsx       # Optical scan and object segmentation
│   ├── services/
│   │   ├── attribution.ts       # Creator attribution & anti-tamper registry
│   │   ├── jarvisBrain.ts       # Command dispatcher, routing, & streaming
│   │   └── speech.ts            # Speech synthesis & dictation service
│   ├── types.ts                 # Shared TypeScript interfaces
│   ├── App.tsx                  # Main application state and view router
│   ├── index.css                # HUD styling and neon cyan palette
│   └── main.tsx                 # React entry point
├── index.html                   # HTML entry point with Share Tech Mono font
├── metadata.json                # AI Studio application metadata
├── package.json                 # Dependencies and dev server scripts
├── tsconfig.json                # TypeScript compiler configuration
└── vite.config.ts               # Vite configuration
```

---

## Development

```bash
# Install dependencies
npm install

# Start Vite dev server on port 3000
npm run dev

# Build for production
npm run build
```

---

## Keyboard Shortcuts

- **Enter**: Send message
- **Shift + Enter**: Newline
- **Up / Down**: Cycle through previous input history
- **Esc**: Clear composer
- **Ctrl + L**: Clear current display
- **Ctrl + E**: Export conversation as Markdown
- **Ctrl + M**: Toggle voice synthesizer mute

---

## License & Attribution

**MIT — with required attribution.** Free to use, study, modify, and redistribute, provided the creator credit **"J.A.R.V.I.S — (c) 2026 vinod"** is retained in the software, its documentation, and any redistributed or derivative copies.
Removing or obscuring that credit is not permitted. Full text: [LICENSE](LICENSE).
