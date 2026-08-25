"""
J.A.R.V.I.S — Ollama-powered desktop assistant
=================================================
Refactored + restyled version of the original jarvis_gui.py.

Setup:
    pip install customtkinter ollama pillow pyttsx3 SpeechRecognition pyautogui psutil pyaudio

Run:
    python jarvis_gui.py

What changed from the original (see original_reference.py):
  - Fixed: "Home" button was accidentally nested inside open_settings(),
    so it never existed on launch and duplicated itself every time
    Settings was opened.
  - Fixed: mic listening ran on the main thread and froze the whole
    window while waiting for audio. Now threaded.
  - Fixed: background threads (AI reply, vision) were touching Tkinter
    widgets directly, which is not thread-safe. All GUI updates from
    worker threads now go through app.after(...).
  - Fixed: a duplicated right_banner frame (dead code).
  - Fixed: "restart pc" had a confirmation path but no command ever
    triggered it.
  - Fixed: no error handling around ollama.chat() — if the Ollama
    server isn't running, you now get a message in the chat instead
    of a silently dead thread.
  - Fixed: "open edge" was a hardcoded Windows-only path with no
    fallback or error message.
  - Refactored: the ~40-branch if/elif command chain is now a small
    command table, so adding a new command is a one-line addition.
  - Added: model switcher (Auto / specific model), mute toggle,
    active-state sidebar highlighting, animated "thinking" indicator,
    pulsing status dot, Settings panel that actually does something,
    graceful fallback avatar if assets/jarvis_circle.png is missing.
  - Added: image analysis — click 🖼 (or type "analyze image") to pick
    ANY picture on disk, not just the screen, and have the vision
    model describe it.
  - Added: persistent chat history — conversations now survive a
    restart (chat_history.json), replayed on launch, with a
    "clear history" command / Settings button to wipe it.
  - Added: overlap guards — a second message can't be sent while
    Jarvis is still answering the first, and a second image can't be
    analyzed while one is already in flight.
  - Added: performance caps — the visible chat log is trimmed once it
    gets very long, and only the most recent messages are ever sent
    to Ollama as context, so long sessions stay fast.
  - Fixed: Settings could spawn behind the main window and look like
    the click did nothing; it's now forced to the front once on open.

Perf & feature pass (this round):
  - Perf: replies now STREAM in token-by-token via ollama.chat(stream=True)
    instead of blocking until the whole response is generated. This is
    the single biggest perceived-speed win — you start reading the
    answer almost immediately instead of watching "thinking..." for the
    full generation time, and you can Stop a bad answer early.
  - Perf: "auto" model mode used to re-pick a model on every message,
    which meant an ordinary coding back-and-forth could ping-pong
    between the 3b and 7b model — and every switch forces Ollama to
    evict one model and load the other from disk. This was almost
    certainly the real cause of "coding questions take longer". Auto
    mode is now sticky: it only drops back to the small model after a
    few non-coding messages in a row, not on the very next one.
  - Perf: models are warmed up in the background right after launch
    (a throwaway 1-token prompt) so the model is already resident in
    RAM/VRAM before your first real message, instead of your first
    message paying the full cold-load cost.
  - Perf: keep_alive is now explicitly set (30 min) on every request so
    a model you just used doesn't get evicted after Ollama's default
    5-minute idle window mid-conversation.
  - Added: Stop button — the send button turns into a stop control
    while a reply is streaming, so you can cancel long/wrong answers.
  - Added: Regenerate (🔁) — redo the last answer without retyping it.
  - Added: Copy last reply (📋) to clipboard.
  - Added: Export chat (💾 / "export chat" / Settings) to a .md file.
  - Added: fenced ``` code blocks now render in a distinct
    monospace/highlighted style, live as they stream in.
  - Added: a status-bar readout after each reply showing elapsed time,
    tokens/sec (when Ollama reports it), and which model answered.
  - Added: Settings now exposes temperature and max response length
    (num_predict), plus shows the active keep-alive value.
  - Added: startup check that warns if a model in AVAILABLE_MODELS
    hasn't actually been pulled yet, instead of failing silently on
    first use.

Usability pass (latest round):
  - UI: every icon button now has a hover tooltip (no more memorizing
    what 🗑/🔁/💾 mean).
  - UI: messages get clean "YOU · 14:32" / "JARVIS · 14:32 · model"
    headers with timestamps instead of bulky ASCII boxes.
  - UI: the status dot now reflects reality — green when the Ollama
    server is reachable, red when it isn't (checked in the background
    every 15s), and the pill shows which model "auto" actually picked.
  - UI: clicking "Home" no longer wipes the visible chat with the boot
    animation; it shows a quick overview instead.
  - UI: first run (no history) shows a quick-start guide after boot.
  - Added: AI replies are now actually spoken aloud (code blocks are
    skipped); the 🔊 toggle mutes them.
  - Added: input history — press ↑/↓ in the input box to cycle through
    previously sent messages.
  - Added: keyboard shortcuts — Ctrl+L clear screen, Ctrl+E export,
    Ctrl+M mute, Ctrl+Q quit.
  - Added: "new chat" command resets the conversation (screen +
    context + history) without restarting the app.
  - Added: "search <query>" opens a web search, "screenshot" analyzes
    the screen from the text box, "open notepad"/"open calculator".
  - Added: Settings model dropdown is populated from the models you
    actually have pulled in Ollama, and the vision model is
    configurable there too.
  - Fixed: a ``` code fence split across two stream flushes used to
    print literal backticks and lose code highlighting.
  - Fixed: the Settings "Voice replies" switch now reflects the real
    mute state instead of always starting in the same position.

Gemini-style redesign (latest round):
  - UI: flat Gemini-like palette (#131314 background) with a borderless
    look — no neon boxes/frames around the banner or input area.
  - UI: new sidebar — brand, rounded "＋ New chat" pill, flat nav items,
    and a "Recent" list of your previous prompts (click to re-send);
    Settings is pinned to the bottom of the sidebar.
  - UI: the big banner/avatar header is gone; the status pill moved to a
    slim top strip (plus 🔊 mute toggle).
  - UI: Gemini-style pill input bar — ＋ attach menu (image/screen
    analysis, regenerate, copy, export, help), drag-free entry, a model
    selector inside the bar, 🎤 dictate, ➤ send/■ stop.
  - UI: centered "Ready when you are" greeting shows when the chat is
    empty (like Gemini.com) and hides on first message; "New chat"
    brings it back.
  - Fixed: model selector in the bar and the Settings dropdown used to
    fall out of sync; both now go through one setter.
Redesign (GUI v4 — this round):
  - UI: a floating Jarvis orb (animated arc-reactor) now lives in the
    centre of the empty chat instead of the plain "Ready when you are"
    text — concentric rotating glow arcs + a pulsing core, inspired by
    the classic Jarvis circle. It uses assets/jarvis_circle.png when
    present (rotating ring on top), otherwise draws a pure-code ring.
    The orb aims (soft-follows) your cursor, tilts subtly, and expands
    into "thinking" mode while a reply is streaming (heavier pulse +
    re-coloured core), then fades away as soon as the conversation
    starts. "New chat" brings it back — like Gemini's centre greeting.
  - Fixed: status pill/timer text no longer flickers every second —
    it only re-renders when the content actually changes.
  - Fixed: boot-log lines used to inherit the right-justified "user"
    tag and hug the right edge of the chat; now labelled "boot".
  - Fixed: status pill showed a bare "auto" until the first resolved
    model; now shows "auto" (no arrow) until a model is picked.
  - Fixed: "New chat" sidebar pill clicked while a reply streams used
    to be a no-op; it now clears and resets immediately.

HUD theme (GUI v5 — this round):
  - Removed the floating orb entirely.
  - Full amber/orange JARVIS HUD palette; angular borders instead of
    rounded pills.
  - Empty chat now shows a centered HUD panel: "How can I help you,
    Sir?" + quick-action icons (Voice, Code Mode, Browser, Terminal,
    Files, Notes, Calculator).
  - Sidebar: J.A.R.V.I.S / "JUST A RATHER VERY INTELLIGENT SYSTEM"
    header, HUD nav rows with icons + chevrons, live SYSTEM STATUS
    bars (CPU/RAM/NET), user card ("USER: <name> · CLEARANCE: LEVEL 7")
    pinned at the bottom.
  - Input bar restyled: amber angular border, "How can I help you,
    Sir?" placeholder; "JARVIS STATUS / ALL SYSTEMS OPERATIONAL"
    readout above it.
  - Added: "clear screen" / "clear chat" text commands.
"""

import os
import re
import sys
import json
import time
import queue
import platform
import threading
import webbrowser
import tkinter as tk
from datetime import datetime
from tkinter import filedialog
from urllib.parse import quote_plus

import customtkinter as ctk
from PIL import Image, ImageDraw
import ollama
import pyttsx3
import pyautogui
import psutil
import speech_recognition as sr

# ============================================================
# Paths / persistence
# ============================================================

def resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except AttributeError:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)


MEMORY_FILE = "memory.json"
LOG_FILE = "jarvis.log"
CHAT_HISTORY_FILE = "chat_history.json"

# Performance caps — keeps the app snappy across very long sessions
# instead of the chat log and Ollama context growing without bound.
MAX_HISTORY_MESSAGES = 200   # messages kept in chat_history.json
MAX_CONTEXT_MESSAGES = 6     # messages actually sent to Ollama per turn
MAX_CHATBOX_LINES = 800      # visible lines kept in the on-screen log


def load_memory():
    try:
        with open(MEMORY_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_memory(mem):
    try:
        with open(MEMORY_FILE, "w") as f:
            json.dump(mem, f, indent=4)
    except OSError as e:
        log_action(f"Failed to save memory: {e}")


def load_chat_history():
    try:
        with open(CHAT_HISTORY_FILE, "r") as f:
            data = json.load(f)
            return data[-MAX_HISTORY_MESSAGES:]
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_chat_history():
    try:
        with open(CHAT_HISTORY_FILE, "w") as f:
            json.dump(chat_history[-MAX_HISTORY_MESSAGES:], f, indent=2)
    except OSError as e:
        log_action(f"Failed to save chat history: {e}")


def log_action(action):
    try:
        with open(LOG_FILE, "a") as f:
            f.write(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {action}\n")
    except OSError:
        pass  # logging should never be able to crash the app


memory = load_memory()
chat_history = load_chat_history()   # rolling message list, persisted to disk
pending_action = None                 # "shutdown" | "restart" | None

AVAILABLE_MODELS = ["auto", "qwen2.5:3b", "qwen2.5-coder:7b"]
CODING_KEYWORDS = [
    "code", "python", "java", "c++", "javascript", "html", "css",
    "program", "script", "leetcode", "bug", "error", "debug",
]
current_model = "auto"

# --- Generation / perf tuning -------------------------------------------
# keep_alive tells Ollama how long to keep a model resident in RAM/VRAM
# after a response. The default is 5 minutes; bumping it means a model
# you just used stays hot instead of being evicted and reloaded from
# disk on your very next message (a multi-second hit, worse for the 7b
# coder model than the 3b one).
KEEP_ALIVE = "30m"
current_temperature = 0.4
current_num_predict = -1     # -1 = model default (no artificial cap)

# "auto" mode used to re-resolve the model on *every single message*,
# which meant a normal back-and-forth coding conversation ("write a
# function" -> "why does it fail" -> "fix it") could bounce between the
# 3b and 7b model repeatedly, and every bounce forces Ollama to unload
# one model and load the other from disk. That reload — not the model
# itself — was almost certainly the "takes longer for coding questions"
# slowdown. These two globals make auto mode *sticky*: once a coding
# message switches to the coder model, plain follow-ups stay on it
# instead of swapping back immediately.
_last_resolved_model = None
_consecutive_non_coding = 0
STICKY_NON_CODING_THRESHOLD = 3

# ============================================================
# Voice engine — single persistent worker + queue so speech
# calls never overlap or block the GUI thread.
# ============================================================

_tts_queue = queue.Queue()
_tts_enabled = True


def _tts_worker():
    global _tts_enabled
    try:
        engine = pyttsx3.init()
    except Exception as e:
        # No audio device/driver (e.g. headless box) — disable TTS instead
        # of dying with a traceback every launch.
        _tts_enabled = False
        log_action(f"TTS unavailable, voice replies disabled: {e}")
        while True:
            _tts_queue.get()  # drain so queued text doesn't pile up
    while True:
        text = _tts_queue.get()
        if _tts_enabled:
            engine.say(text)
            engine.runAndWait()


threading.Thread(target=_tts_worker, daemon=True).start()


def speak(text):
    if _tts_enabled:
        _tts_queue.put(text)


def _speakable(text):
    """Strip code blocks/markdown from a reply before speaking it, and cap
    the length so a huge answer doesn't lock up the TTS queue for minutes."""
    text = re.sub(r"```.*?```", " (code block omitted) ", text, flags=re.DOTALL)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:600] + ("..." if len(text) > 600 else "")


def _stamp():
    return datetime.now().strftime("%H:%M")


def take_screenshot():
    screenshot = pyautogui.screenshot()
    screenshot.save("current_screen.png")
    return "current_screen.png"


# ============================================================
# Theme tokens
# ============================================================

VOID = "#0B0A08"
PANEL = "#14110C"
PANEL_ALT = "#1E1A12"
CYAN = "#FFB300"          # HUD amber
CYAN_DIM = "#4A350F"      # dark amber
AMBER = "#FF8C00"         # HUD orange
GREEN = "#66FF99"
RED = "#E06C75"
TEXT_MAIN = "#F5EFE3"
TEXT_DIM = "#8A8172"

FONT_DISPLAY = ("Orbitron", 32, "bold")
FONT_SUB = ("Rajdhani", 15)
FONT_NAV = ("Rajdhani", 16, "bold")
FONT_MONO = ("JetBrains Mono", 14)
FONT_MONO_SM = ("JetBrains Mono", 12)

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("dark-blue")

app = ctk.CTk()
app.title("J.A.R.V.I.S")
app.geometry("1180x780")
app.minsize(900, 600)
app.configure(fg_color=VOID)

# 2-column grid: sidebar | content. Content splits into rows.
app.grid_columnconfigure(1, weight=1)
app.grid_rowconfigure(0, weight=1)


# ============================================================
# Sidebar (Gemini-style: brand, New chat pill, flat nav, Recent)
# ============================================================

sidebar = ctk.CTkFrame(app, width=250, fg_color=PANEL, corner_radius=0,
                        border_width=0)
sidebar.grid(row=0, column=0, sticky="nsw")
sidebar.grid_propagate(False)

ctk.CTkLabel(sidebar, text="J.A.R.V.I.S", font=("Rajdhani", 22, "bold"),
             text_color=AMBER).pack(pady=(18, 0), padx=18, anchor="w")
ctk.CTkLabel(sidebar, text="JUST A RATHER VERY INTELLIGENT SYSTEM",
             font=("Rajdhani", 9),
             text_color=TEXT_DIM).pack(pady=(0, 14), padx=18, anchor="w")

new_chat_button = ctk.CTkButton(
    sidebar, text="＋  New chat", font=("Rajdhani", 15, "bold"), anchor="w",
    height=42, corner_radius=21, fg_color=PANEL_ALT, hover_color=CYAN_DIM,
    text_color=TEXT_MAIN, command=lambda: cmd_new_chat("", from_pill=True))
new_chat_button.pack(fill="x", padx=14, pady=(0, 14))

nav_buttons = {}


def make_nav_button(key, label, command, at_bottom=False, icon=""):
    """HUD-style nav row: icon, label, chevron — thin amber border."""
    text = f"{icon}  {label.upper()}  ›" if icon else f"{label.upper()}  ›"
    btn = ctk.CTkButton(
        sidebar, text=text, font=("Rajdhani", 14, "bold"), anchor="w",
        fg_color="transparent", hover_color=CYAN_DIM,
        text_color=TEXT_DIM, corner_radius=6, height=40,
        border_width=1, border_color=CYAN_DIM,
        command=command,
    )
    if at_bottom:
        btn.pack(fill="x", padx=10, pady=4, side="bottom")
    else:
        btn.pack(fill="x", padx=10, pady=2)
    nav_buttons[key] = btn
    return btn


def set_active_nav(key):
    for k, btn in nav_buttons.items():
        if k == key:
            btn.configure(fg_color=CYAN_DIM, text_color=CYAN)
        else:
            btn.configure(fg_color="transparent", text_color=TEXT_DIM)


# --- Recent (previous prompts, click to re-send) --------------

ctk.CTkLabel(sidebar, text="Recent", font=("Rajdhani", 13, "bold"),
             text_color=TEXT_DIM).pack(anchor="w", padx=16, pady=(12, 2))
recent_list_frame = ctk.CTkFrame(sidebar, fg_color="transparent")
recent_list_frame.pack(fill="x", padx=6)

# --- SYSTEM STATUS panel (live CPU/RAM/NET bars) --------------
status_panel = ctk.CTkFrame(sidebar, fg_color="transparent",
                            border_width=1, border_color=CYAN_DIM,
                            corner_radius=6)
status_panel.pack(fill="x", padx=10, pady=(16, 6))
ctk.CTkLabel(status_panel, text="SYSTEM STATUS",
             font=("Rajdhani", 11, "bold"),
             text_color=AMBER).pack(anchor="w", padx=10, pady=(8, 4))

_bars = {}
for _name in ("CPU", "RAM", "NET"):
    row = ctk.CTkFrame(status_panel, fg_color="transparent")
    row.pack(fill="x", padx=10, pady=2)
    ctk.CTkLabel(row, text=_name, font=("Rajdhani", 10),
                 text_color=TEXT_DIM, width=32, anchor="w").pack(side="left")
    bar = ctk.CTkProgressBar(row, height=6, corner_radius=2,
                             fg_color=PANEL_ALT, progress_color=AMBER)
    bar.set(0)
    bar.pack(side="left", fill="x", expand=True, padx=(4, 0))
    pct = ctk.CTkLabel(row, text="0%", font=("Rajdhani", 10),
                       text_color=TEXT_DIM, width=36)
    pct.pack(side="left")
    _bars[_name] = (bar, pct)
ctk.CTkLabel(status_panel, text="", height=4).pack()  # breathing room

_last_net = psutil.net_io_counters()


def update_status_bars():
    global _last_net
    try:
        _bars["CPU"][0].set(psutil.cpu_percent() / 100)
        _bars["CPU"][1].configure(text=f"{psutil.cpu_percent():.0f}%")
        _bars["RAM"][0].set(psutil.virtual_memory().percent / 100)
        _bars["RAM"][1].configure(text=f"{psutil.virtual_memory().percent:.0f}%")
        net = psutil.net_io_counters()
        kb = ((net.bytes_sent - _last_net.bytes_sent)
              + (net.bytes_recv - _last_net.bytes_recv)) / 1024
        _last_net = net
        load = min(kb / 512, 1.0)  # ~512 KB/s between ticks counts as busy
        _bars["NET"][0].set(load)
        _bars["NET"][1].configure(text=f"{kb:.0f}K" if kb < 1024
                                   else f"{kb/1024:.1f}M")
    except Exception:
        pass


def _reuse_recent(message):
    set_active_nav("chat")
    entry.delete(0, "end")
    entry.insert(0, message)


def refresh_recent():
    """Sidebar "Recent" list — last few user prompts, click to re-send."""
    for w in recent_list_frame.winfo_children():
        w.destroy()
    recents = [m["content"] for m in chat_history
               if m.get("role") == "user"][-8:]
    if not recents:
        ctk.CTkLabel(recent_list_frame, text="  (nothing yet)",
                     font=("Rajdhani", 12),
                     text_color=TEXT_DIM).pack(anchor="w")
        return
    for msg in reversed(recents):
        short = (msg[:30] + "…") if len(msg) > 30 else msg
        b = ctk.CTkButton(
            recent_list_frame, text=short, font=("Rajdhani", 13), anchor="w",
            height=30, fg_color="transparent", hover_color=PANEL_ALT,
            text_color=TEXT_DIM, corner_radius=8,
            command=lambda m=msg: _reuse_recent(m))
        b.pack(fill="x")


# ============================================================
# Content column (Gemini-style: no boxed frames, pill input bar)
# ============================================================

content = ctk.CTkFrame(app, fg_color=VOID, corner_radius=0)
content.grid(row=0, column=1, sticky="nsew")
content.grid_columnconfigure(0, weight=1)
content.grid_rowconfigure(1, weight=1)

# --- slim top strip: status pill + voice toggle ---------------
top_strip = ctk.CTkFrame(content, fg_color=VOID, height=34)
top_strip.grid(row=0, column=0, sticky="ew")
top_strip.grid_propagate(False)

status_cluster = ctk.CTkFrame(top_strip, fg_color=PANEL_ALT,
                               corner_radius=17, height=34)
status_cluster.pack(side="right", padx=14, pady=4)
status_dot = ctk.CTkLabel(status_cluster, text="●", font=("Arial", 13),
                           text_color=GREEN)
status_dot.pack(side="left", padx=(12, 4))
status_pill_text = ctk.CTkLabel(status_cluster, text="ONLINE",
                                 font=FONT_MONO_SM, text_color=TEXT_MAIN)
status_pill_text.pack(side="left", padx=(0, 12))

voice_button = ctk.CTkButton(
    top_strip, text="🔊", width=34, height=34, corner_radius=17,
    fg_color=PANEL_ALT, hover_color=CYAN_DIM, text_color=TEXT_MAIN,
    font=("Consolas", 14), command=lambda: toggle_voice())
voice_button.pack(side="right", padx=8)

# --- chat log -------------------------------------------------
chat_box = ctk.CTkTextbox(content, font=FONT_MONO, fg_color=VOID,
                           border_width=0,
                           corner_radius=14, wrap="word")
chat_box.grid(row=1, column=0, sticky="nsew", padx=18, pady=8)

chat_box.tag_config("user", foreground=CYAN, justify="right", rmargin=16,
                     lmargin1=200, lmargin2=200, spacing3=10)
chat_box.tag_config("jarvis", foreground=GREEN, justify="left", lmargin1=16,
                     lmargin2=16, rmargin=200, spacing3=10)
chat_box.tag_config("user_meta", foreground=TEXT_DIM, justify="right",
                     rmargin=16, spacing1=12)
chat_box.tag_config("jarvis_meta", foreground=TEXT_DIM, justify="left",
                     lmargin1=16, lmargin2=16, spacing1=12)
chat_box.tag_config("system", foreground=AMBER, justify="center", spacing1=6,
                     spacing3=6)
chat_box.tag_config("error", foreground=RED, justify="left", spacing1=6,
                     spacing3=6)
chat_box.tag_config("code", foreground=AMBER, justify="left", lmargin1=24,
                     lmargin2=24, rmargin=24, spacing1=2, spacing3=2,
                     background=PANEL_ALT)
# left-justified cyan for boot/log lines — the old style fell back to the
# right-aligned "user" tag and hugged the right edge.
chat_box.tag_config("boot", foreground=CYAN, justify="left", lmargin1=16,
                     lmargin2=16, spacing1=2, spacing3=2)

# --- empty-chat HUD panel (replaces the old floating orb) ---
_hud_panel = None


def _open_terminal():
    system = platform.system()
    if system == "Windows":
        os.system("start cmd")
    elif system == "Darwin":
        os.system("open -a Terminal")
    else:
        os.system("x-terminal-emulator &")


QUICK_ACTIONS = [
    ("🎤", "VOICE CMD", lambda: listen_voice()),
    ("</>", "CODE MODE", lambda: set_current_model("qwen2.5-coder:7b")),
    ("🌐", "BROWSER", lambda: webbrowser.open("https://www.google.com")),
    ("⌨", "TERMINAL", _open_terminal),
    ("📁", "FILES", lambda: open_downloads()),
    ("📝", "NOTES", lambda: open_notepad()),
    ("🧮", "CALCULATOR", lambda: open_calculator()),
]


def _build_hud_panel():
    """Centered amber HUD panel shown when the chat is empty."""
    global _hud_panel
    panel = ctk.CTkFrame(content, fg_color=PANEL,
                         border_width=1, border_color=AMBER,
                         corner_radius=8)
    ctk.CTkLabel(panel, text="How can I help you, Sir?",
                 font=("Rajdhani", 22),
                 text_color=TEXT_MAIN).pack(pady=(18, 12), padx=40)
    row = ctk.CTkFrame(panel, fg_color="transparent")
    row.pack(pady=(6, 18), padx=16)
    for icon, label, cmd in QUICK_ACTIONS:
        cell = ctk.CTkFrame(row, fg_color=PANEL_ALT, border_width=1,
                            border_color=AMBER, corner_radius=6)
        cell.pack(side="left", padx=5)
        btn = ctk.CTkButton(cell, text=icon, width=54, height=46,
                            corner_radius=5, fg_color="transparent",
                            hover_color=CYAN_DIM, text_color=GREEN,
                            font=("Consolas", 18), command=cmd)
        btn.pack(padx=2, pady=2)
        ctk.CTkLabel(cell, text=label, font=("Rajdhani", 9),
                     text_color=TEXT_DIM).pack()
        ToolTip(btn, label.title())
    _hud_panel = panel


def _show_greeting():
    """Empty chat: amber HUD panel with quick actions."""
    if _hud_panel is None:
        _build_hud_panel()
    _hud_panel.place(relx=0.5, rely=0.45, anchor="center")


def _hide_greeting():
    if _hud_panel is not None:
        _hud_panel.place_forget()


def make_icon_button(parent, text, command, hover=CYAN_DIM, tip=""):
    """Angular HUD button. Returns the widget for grid/pack."""
    b = ctk.CTkButton(parent, text=text, width=40, height=40, corner_radius=6,
                       fg_color="transparent", hover_color=hover,
                       text_color=TEXT_MAIN, font=("Consolas", 15, "bold"),
                       command=command)
    if tip:
        ToolTip(b, tip)
    return b


class ToolTip:
    """Hover tooltip for the icon buttons — they're unlabeled emoji, so
    without these you have to memorize what each one does."""
    DELAY_MS = 450

    def __init__(self, widget, text):
        self.widget = widget
        self.text = text
        self.tip = None
        self._job = None
        widget.bind("<Enter>", self._schedule)
        widget.bind("<Leave>", self._hide)
        widget.bind("<ButtonPress>", self._hide)

    def _schedule(self, _event=None):
        self._job = self.widget.after(self.DELAY_MS, self._show)

    def _show(self):
        if self.tip is not None:
            return
        tip = tk.Toplevel(self.widget)
        tip.wm_overrideredirect(True)
        tip.configure(bg=PANEL_ALT)
        ctk.CTkLabel(tip, text=self.text, font=("Rajdhani", 12),
                     fg_color=PANEL_ALT, corner_radius=6,
                     text_color=TEXT_MAIN, padx=10, pady=3).pack()
        tip.update_idletasks()
        x = (self.widget.winfo_rootx() + self.widget.winfo_width() // 2
             - tip.winfo_width() // 2)
        y = self.widget.winfo_rooty() - tip.winfo_height() - 8
        tip.wm_geometry(f"+{max(x, 0)}+{max(y, 0)}")
        self.tip = tip

    def _hide(self, _event=None):
        if self._job is not None:
            self.widget.after_cancel(self._job)
            self._job = None
        if self.tip is not None:
            self.tip.destroy()
            self.tip = None


# --- status line -------------------------------------------------
status_label = ctk.CTkLabel(content, text="Ready", font=FONT_MONO_SM,
                             text_color=TEXT_DIM)
status_label.grid(row=2, column=0, sticky="w", padx=24, pady=(0, 2))
ctk.CTkLabel(content, text="JARVIS STATUS\nALL SYSTEMS OPERATIONAL",
              font=("Rajdhani", 10, "bold"), text_color=GREEN,
              justify="right").grid(row=2, column=0, sticky="e", padx=24,
                                     pady=(0, 2))

# --- HUD input bar ----------------------------------------------
bottom = ctk.CTkFrame(content, fg_color=PANEL, corner_radius=6,
                      border_width=1, border_color=AMBER)
bottom.grid(row=3, column=0, sticky="ew", padx=20, pady=(2, 16))
bottom.grid_columnconfigure(1, weight=1)


def _show_attach_menu():
    """Popup for the ＋ button (like Gemini's attach plus): vision tools,
    reply utilities, and help."""
    menu = tk.Menu(app, tearoff=0, bg=PANEL, fg=TEXT_MAIN,
                   activebackground=CYAN_DIM, activeforeground=TEXT_MAIN)
    menu.add_command(label="🖼  Analyze image", command=pick_and_analyze_image)
    menu.add_command(label="📸  Analyze screen",
                     command=lambda: cmd_screenshot(""))
    menu.add_separator()
    menu.add_command(label="🔁  Regenerate last reply",
                     command=regenerate_last)
    menu.add_command(label="📋  Copy last reply", command=copy_last_response)
    menu.add_command(label="💾  Export chat", command=export_chat)
    menu.add_separator()
    menu.add_command(label="❓  Help (all commands)",
                     command=lambda: cmd_help(""))
    x = attach_button.winfo_rootx()
    y = attach_button.winfo_rooty() - 10
    menu.tk_popup(x, y)


attach_button = ctk.CTkButton(
    bottom, text="＋", width=40, height=40, corner_radius=6,
    fg_color="transparent", hover_color=CYAN_DIM, text_color=TEXT_MAIN,
    font=("Consolas", 18), command=_show_attach_menu)
attach_button.grid(row=0, column=0, padx=(12, 2), pady=8)
ToolTip(attach_button, "Vision tools, reply utilities, and help")

entry = ctk.CTkEntry(bottom, placeholder_text="How can I help you, Sir?",
                      height=44, corner_radius=4, border_width=0,
                      fg_color="transparent",
                      text_color=TEXT_MAIN, placeholder_text_color=TEXT_DIM,
                      font=("Rajdhani", 16))
entry.grid(row=0, column=1, sticky="ew", pady=6)


def set_current_model(choice):
    """One place to change the model — keeps the bar selector and the
    Settings dropdown in sync (they used to disagree with each other)."""
    global current_model
    current_model = choice
    model_selector.set(choice)
    set_status(f"Model set to {choice}")


model_selector = ctk.CTkOptionMenu(
    bottom, values=["auto"] + AVAILABLE_MODELS[1:], width=132, height=36,
    corner_radius=18, fg_color=PANEL_ALT, button_color=CYAN_DIM,
    text_color=TEXT_MAIN, font=("Rajdhani", 13),
    command=set_current_model)
model_selector.grid(row=0, column=2, padx=(4, 2), pady=8)
model_selector.set(current_model)

mic_button = make_icon_button(
    bottom, "🎤", lambda: listen_voice(),
    tip="Dictate a message (voice input)")
mic_button.grid(row=0, column=3, padx=2, pady=8)

send_button = make_icon_button(
    bottom, "➤", lambda: send_message(),
    tip="Send (Enter) — becomes Stop while replying")
send_button.grid(row=0, column=4, padx=(2, 12), pady=8)


# ============================================================
# Thread-safe GUI helpers
# ============================================================

def append_chat(text, tag=None):
    def _do():
        chat_box.insert("end", text, tag)
        # Trim old lines once the log gets long — keeps the widget snappy
        # over multi-hour sessions instead of growing forever.
        line_count = int(chat_box.index("end-1c").split(".")[0])
        if line_count > MAX_CHATBOX_LINES:
            chat_box.delete("1.0", f"{line_count - MAX_CHATBOX_LINES}.0")
        chat_box.see("end")
    app.after(0, _do)


def set_status(text):
    app.after(0, lambda: status_label.configure(text=text))


_thinking = False


def _animate_thinking(i=0):
    if not _thinking:
        return
    status_label.configure(text="JARVIS IS THINKING" + "." * (i % 4))
    app.after(350, lambda: _animate_thinking(i + 1))


def start_thinking():
    global _thinking
    _thinking = True
    _animate_thinking()


def stop_thinking(final_text="Ready"):
    global _thinking
    _thinking = False
    status_label.configure(text=final_text)


_ollama_online = True


def _health_check_loop():
    """Pings the Ollama server in the background so the status dot reflects
    reality (green = reachable, red = down) instead of always claiming
    ONLINE. Cheap: ollama.list() against a local server is instant."""
    global _ollama_online
    while True:
        try:
            ollama.list()
            _ollama_online = True
        except Exception:
            _ollama_online = False
        time.sleep(15)


# ============================================================
# AI / vision / voice
# ============================================================

_ai_busy = False


def resolve_model(message):
    global _last_resolved_model, _consecutive_non_coding
    if current_model != "auto":
        return current_model

    is_coding = any(word in message.lower() for word in CODING_KEYWORDS)
    if is_coding:
        _consecutive_non_coding = 0
        _last_resolved_model = "qwen2.5-coder:7b"
    else:
        _consecutive_non_coding += 1
        # Only fall back to the light model once we've seen a few
        # non-coding messages in a row — a single "why?" or "thanks"
        # mid-debugging-session shouldn't trigger a full model reload.
        if _last_resolved_model is None or _consecutive_non_coding >= STICKY_NON_CODING_THRESHOLD:
            _last_resolved_model = "qwen2.5:3b"
    return _last_resolved_model


def _set_input_enabled(enabled):
    state = "normal" if enabled else "disabled"
    app.after(0, lambda: entry.configure(state=state))


_stop_generation = False


def stop_generation():
    """Called from the Stop button (send_button while a reply is streaming)."""
    global _stop_generation
    _stop_generation = True
    set_status("Stopping...")


def _set_generating_ui(active):
    def _do():
        if active:
            send_button.configure(text="■", command=stop_generation,
                                   fg_color=RED, hover_color="#B3364C")
        else:
            send_button.configure(text="➤", command=send_message,
                                   fg_color=PANEL_ALT, hover_color=CYAN_DIM)
    app.after(0, _do)


def _stream_insert(piece, in_code):
    """Insert a streamed chunk, toggling the 'code' tag whenever a ``` fence
    is crossed so fenced code blocks render in a distinct style even while
    still streaming in."""
    remaining = piece
    while "```" in remaining:
        before, remaining = remaining.split("```", 1)
        if before:
            append_chat(before, "code" if in_code else "jarvis")
        in_code = not in_code
    if remaining:
        append_chat(remaining, "code" if in_code else "jarvis")
    return in_code


def _split_holdback(buffer):
    """Hold back 1-2 trailing backticks that might be the start of a ```
    fence split across two stream flushes — without this, a fence arriving
    mid-flush prints literal backticks and code highlighting never kicks in."""
    stripped = buffer.rstrip("`")
    trailing = len(buffer) - len(stripped)
    if 0 < trailing < 3:
        return stripped, buffer[len(stripped):]
    return buffer, ""


_last_user_message = None
_last_assistant_reply = None


def get_ai_response(message, is_regenerate=False):
    """Streams the reply token-by-token instead of blocking until the whole
    thing is generated. This doesn't make the model itself faster, but it
    slashes *perceived* latency (you start reading immediately instead of
    staring at 'thinking...' for the entire generation) and lets you Stop
    a reply that's clearly going the wrong way instead of waiting it out."""
    global _ai_busy, _stop_generation, _last_user_message, _last_assistant_reply
    global _ollama_online

    memory_text = "\n".join(f"{k}: {v}" for k, v in memory.items())
    system_message = {
        "role": "system",
        "content": f"You are Jarvis, a concise personal AI assistant.\n\n"
                    f"User memory:\n{memory_text}\n\nAnswer concisely.",
    }
    if not is_regenerate:
        chat_history.append({"role": "user", "content": message})
    _last_user_message = message
    model_name = resolve_model(message)

    _ai_busy = True
    _stop_generation = False
    _set_input_enabled(False)
    _set_generating_ui(True)
    start_thinking()

    append_chat(f"JARVIS · {_stamp()} · {model_name}\n", "jarvis_meta")

    reply_parts = []
    buffer = ""
    in_code = False
    last_flush = time.monotonic()
    eval_count = eval_duration = None
    start_t = time.monotonic()

    try:
        stream = ollama.chat(
            model=model_name,
            messages=[system_message] + chat_history[-MAX_CONTEXT_MESSAGES:],
            stream=True,
            keep_alive=KEEP_ALIVE,
            options={
                "temperature": current_temperature,
                **({"num_predict": current_num_predict} if current_num_predict != -1 else {}),
            },
        )
        for part in stream:
            if _stop_generation:
                break
            piece = part.get("message", {}).get("content", "")
            if piece:
                reply_parts.append(piece)
                buffer += piece
            # Flush roughly 20x/sec instead of on every token — plenty
            # smooth to read, but far fewer GUI-thread calls than one
            # app.after() per token.
            now = time.monotonic()
            if buffer and (now - last_flush > 0.05):
                emit, buffer = _split_holdback(buffer)
                if emit:
                    in_code = _stream_insert(emit, in_code)
                last_flush = now
            if part.get("done"):
                eval_count = part.get("eval_count")
                eval_duration = part.get("eval_duration")
        if buffer:
            in_code = _stream_insert(buffer, in_code)

        _ollama_online = True
        reply = "".join(reply_parts)
        append_chat("\n\n", "jarvis")

        if reply.strip():
            chat_history.append({"role": "assistant", "content": reply})
            save_chat_history()
            _last_assistant_reply = reply
            speak(_speakable(reply))

        elapsed = time.monotonic() - start_t
        if eval_count and eval_duration:
            tok_s = eval_count / (eval_duration / 1e9)
            timing = f"Ready · {elapsed:.1f}s · {tok_s:.0f} tok/s · {model_name}"
        else:
            timing = f"Ready · {elapsed:.1f}s · {model_name}"

        if _stop_generation:
            append_chat("[SYSTEM] > Generation stopped.\n\n", "system")
            timing = "Stopped"
        stop_thinking(timing)
    except Exception as e:
        _ollama_online = False
        append_chat(
            f"\n[ERROR] Couldn't reach Ollama ({model_name}). "
            f"Is `ollama serve` running?\n{e}\n\n", "error",
        )
        stop_thinking("Ready")
    finally:
        _ai_busy = False
        _set_generating_ui(False)
        _set_input_enabled(True)


def regenerate_last():
    """Re-runs the AI on the last user message, discarding the previous
    assistant reply so it doesn't linger in the context sent to Ollama."""
    if _ai_busy:
        return
    if _last_user_message is None:
        append_chat("Jarvis: Nothing to regenerate yet.\n\n", "error")
        return
    if chat_history and chat_history[-1].get("role") == "assistant":
        chat_history.pop()
    append_chat("[SYSTEM] > Regenerating last response...\n\n", "system")
    threading.Thread(target=get_ai_response,
                      args=(_last_user_message,), kwargs={"is_regenerate": True},
                      daemon=True).start()


def copy_last_response():
    if not _last_assistant_reply:
        set_status("Nothing to copy yet")
        return
    app.clipboard_clear()
    app.clipboard_append(_last_assistant_reply)
    set_status("Copied last response to clipboard")


def get_installed_models():
    """Model names currently pulled in Ollama, for the Settings dropdown."""
    try:
        names = {m.get("model") or m.get("name")
                 for m in ollama.list().get("models", [])}
        return sorted(n for n in names if n)
    except Exception:
        return []


def check_and_warm_models():
    """Runs once at launch, off the GUI thread. Two jobs:
    1. Tell the user up front if a model in AVAILABLE_MODELS hasn't
       actually been pulled, instead of them finding out mid-conversation.
    2. Send a throwaway 1-token prompt to the text models so they're
       already loaded into RAM/VRAM by the time you send your first real
       message — the first message after launch used to eat the full
       model-load time on top of the actual response time.
    """
    try:
        installed = {m.get("model") or m.get("name") for m in ollama.list().get("models", [])}
    except Exception as e:
        append_chat(
            f"[ERROR] Can't reach the Ollama server: {e}\n"
            f"Is `ollama serve` running?\n\n", "error",
        )
        return

    missing = [
        m for m in AVAILABLE_MODELS
        if m != "auto" and not any(m == i or i.startswith(m.split(":")[0] + ":") for i in installed)
    ]
    if missing:
        append_chat(
            "[SYSTEM] > Not pulled yet: " + ", ".join(missing) +
            "  (run `ollama pull <model>`)\n\n", "system",
        )

    for model_name in ("qwen2.5:3b", "qwen2.5-coder:7b"):
        if model_name in missing:
            continue
        try:
            ollama.chat(
                model=model_name,
                messages=[{"role": "user", "content": "hi"}],
                keep_alive=KEEP_ALIVE,
                options={"num_predict": 1},
            )
        except Exception:
            pass  # non-critical — worst case the first real message warms it up instead


_vision_busy = False

VISION_MODEL = "llama3.2-vision:latest"
IMAGE_FILETYPES = [
    ("Image files", "*.png *.jpg *.jpeg *.bmp *.webp *.gif"),
    ("All files", "*.*"),
]


def _run_vision(image_path, label, prompt="Analyze this image in detail."):
    """Shared core for both screenshot analysis and uploaded-image analysis."""
    global _vision_busy
    if _vision_busy:
        append_chat("Jarvis: Still analyzing the previous image — one sec.\n\n",
                     "error")
        return
    _vision_busy = True
    set_status(f"Analyzing {label}...")
    try:
        response = ollama.chat(
            model=VISION_MODEL,
            messages=[{
                "role": "user",
                "content": prompt,
                "images": [image_path],
            }],
        )
        result = response["message"]["content"]
        append_chat(f"\nJARVIS VISION ({label}) >\n{result}\n\n", "jarvis")
        chat_history.append({"role": "user", "content": f"[Image: {label}] {prompt}"})
        chat_history.append({"role": "assistant", "content": result})
        save_chat_history()
    except Exception as e:
        append_chat(
            f"[ERROR] Vision analysis failed: {e}\n"
            f"(Make sure a vision model is pulled, e.g. "
            f"`ollama pull {VISION_MODEL}`)\n\n", "error",
        )
    finally:
        set_status("Ready")
        _vision_busy = False


def analyze_screenshot():
    image_path = take_screenshot()
    _run_vision(image_path, "screenshot")


def pick_and_analyze_image():
    """Opens a native file picker so the user can analyze any picture on
    their computer, not just what's currently on screen."""
    path = filedialog.askopenfilename(
        title="Choose an image for Jarvis to analyze",
        filetypes=IMAGE_FILETYPES,
    )
    if not path:
        return
    label = os.path.basename(path)
    threading.Thread(target=_run_vision, args=(path, label), daemon=True).start()


def listen_voice():
    def _listen():
        recognizer = sr.Recognizer()
        set_status("[Listening...]")
        try:
            with sr.Microphone() as source:
                audio = recognizer.listen(source, timeout=5)
            text = recognizer.recognize_google(audio)
            app.after(0, lambda: (entry.delete(0, "end"), entry.insert(0, text)))
        except Exception as e:
            append_chat(f"[ERROR] {e}\n\n", "error")
        finally:
            set_status("Ready")

    threading.Thread(target=_listen, daemon=True).start()


def set_voice_enabled(enabled):
    global _tts_enabled
    _tts_enabled = enabled
    voice_button.configure(text="🔊" if enabled else "🔇")
    set_status("Voice replies on" if enabled else "Voice replies muted")


def toggle_voice():
    set_voice_enabled(not _tts_enabled)


# ============================================================
# App-launch commands (OS-aware, never crash the app)
# ============================================================

def _open_path_cross_platform(path):
    system = platform.system()
    if system == "Windows":
        os.startfile(path)
    elif system == "Darwin":
        os.system(f'open "{path}"')
    else:
        os.system(f'xdg-open "{path}"')


def open_vscode():
    os.system("code")


def open_edge():
    system = platform.system()
    candidates = {
        "Windows": r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "Darwin": "/Applications/Microsoft Edge.app",
        "Linux": "microsoft-edge",
    }
    path = candidates.get(system)
    if not path:
        raise RuntimeError(f"No Edge launch path configured for {system}.")
    if system == "Windows" and not os.path.exists(path):
        raise RuntimeError("Edge not found at the expected Windows path.")
    _open_path_cross_platform(path) if system != "Linux" else os.system("microsoft-edge &")


def open_downloads():
    _open_path_cross_platform(os.path.join(os.path.expanduser("~"), "Downloads"))


def open_notepad():
    system = platform.system()
    if system == "Windows":
        os.startfile("notepad")
    elif system == "Darwin":
        os.system("open -a TextEdit")
    else:
        os.system("gedit &")


def open_calculator():
    system = platform.system()
    if system == "Windows":
        os.system("calc")
    elif system == "Darwin":
        os.system("open -a Calculator")
    else:
        os.system("gnome-calculator &")


APP_COMMANDS = {
    "open vscode": ("Opening VS Code...", open_vscode),
    "open edge": ("Opening Edge...", open_edge),
    "open downloads": ("Opening Downloads...", open_downloads),
    "open notepad": ("Opening Notepad...", open_notepad),
    "open calculator": ("Opening Calculator...", open_calculator),
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
- screenshot           (captures and analyzes your screen)
- (or the ＋ menu in the input bar, or "Vision" in the sidebar)

Chat history:
- new chat              (fresh conversation — clears screen + context)
- clear screen          (wipe visible text, keeps history)
- clear history         (wipes saved conversation history)
- export chat           (save the conversation as a .md file)

Conversation controls:
- regenerate             (redo the last answer)
- stop                   (cancel a reply mid-stream / click ■)
- (the ＋ menu also has: copy last reply, regenerate, export, help)

Sidebar:
- "+ New chat" pill — starts a fresh conversation
- Recent — your last few prompts, click to re-send one
- Settings is pinned at the bottom of the sidebar

Web:
- search <anything>      (opens a Google search in your browser)

Apps:
- open edge / open vscode / open downloads
- open notepad / open calculator

Websites:
- open youtube / open github / open chatgpt

Utilities:
- what time is it
- whats todays date
- shutdown pc / restart pc

Keyboard:
- Enter         send message
- Up / Down     cycle through previously sent messages
- Ctrl+L        clear the on-screen chat
- Ctrl+E        export chat
- Ctrl+M        mute/unmute voice replies
- Ctrl+Q        quit

Tips:
- Hover over the ＋ or icon buttons to see what they do.
- Pick a model in the input bar, or in Settings.
- "Auto" model mode sticks with the coder model through a coding
  back-and-forth instead of reloading a different model every message.
- The status dot is green when Ollama is reachable, red when it's down.
- Model, vision model, temperature, response length, and keep-alive
  time are all adjustable from Settings.

"""


# ============================================================
# Command handling
# ============================================================

def cmd_help(_msg):
    append_chat(HELP_TEXT)


def cmd_show_memory(_msg):
    if memory:
        append_chat("Jarvis Memory:\n")
        for k, v in memory.items():
            append_chat(f"{k} = {v}\n")
        append_chat("\n")
    else:
        append_chat("Jarvis: Memory is empty.\n\n", "error")


def cmd_time(_msg):
    now = datetime.now().strftime("%I:%M %p")
    append_chat(f"Jarvis: The current time is {now}\n\n")
    speak(f"The current time is {now}")


def cmd_date(_msg):
    today = datetime.now().strftime("%d %B %Y")
    append_chat(f"Jarvis: Today's date is {today}\n\n")
    speak(f"Today's date is {today}")


def cmd_shutdown(_msg):
    global pending_action
    pending_action = "shutdown"
    append_chat("Jarvis: Are you sure you want to shut down the PC? (yes/no)\n\n")


def cmd_restart(_msg):
    global pending_action
    pending_action = "restart"
    append_chat("Jarvis: Are you sure you want to restart the PC? (yes/no)\n\n")


def cmd_analyze_image(_msg):
    pick_and_analyze_image()


def cmd_clear_history(_msg):
    chat_history.clear()
    save_chat_history()
    refresh_recent()
    append_chat("Jarvis: Conversation history cleared.\n\n", "system")


def cmd_new_chat(_msg, from_pill=False):
    """Full conversation reset — screen, saved history, and the context that
    gets sent to Ollama — without restarting the app. If called directly
    while a reply is streaming we cancel the current answer first, so the
    "+ New chat" sidebar pill always works."""
    if from_pill and _ai_busy:
        stop_generation()
    global _last_user_message, _last_assistant_reply
    chat_history.clear()
    save_chat_history()
    _last_user_message = None
    _last_assistant_reply = None
    refresh_recent()
    chat_box.delete("1.0", "end")
    _show_greeting()
    set_status("New chat started")


def cmd_screenshot(_msg):
    append_chat("[SYSTEM] > Capturing screen...\n\n", "system")
    threading.Thread(target=analyze_screenshot, daemon=True).start()


def handle_search(message):
    """'search <query>' -> Google search in the default browser."""
    query = message[7:].strip()
    if not query:
        append_chat("Jarvis: Search for what? (search <query>)\n\n", "error")
        return True
    webbrowser.open(f"https://www.google.com/search?q={quote_plus(query)}")
    append_chat(f"[SYSTEM] > Searching the web for: {query}\n\n", "system")
    speak(f"Searching for {query}")
    return True


def export_chat(_msg=None):
    path = filedialog.asksaveasfilename(
        title="Export chat",
        defaultextension=".md",
        initialfile=f"jarvis_chat_{datetime.now():%Y%m%d_%H%M%S}.md",
        filetypes=[("Markdown", "*.md"), ("Text", "*.txt"), ("All files", "*.*")],
    )
    if not path:
        return
    try:
        lines = []
        for msg in chat_history:
            speaker = "**You**" if msg.get("role") == "user" else "**Jarvis**"
            lines.append(f"{speaker}: {msg.get('content', '')}")
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n\n".join(lines))
        append_chat(f"[SYSTEM] > Exported chat to {path}\n\n", "system")
    except OSError as e:
        append_chat(f"[ERROR] Couldn't export chat: {e}\n\n", "error")


def cmd_clear_screen(_msg):
    """Just wipe the visible chat — history and context stay as they are."""
    chat_box.delete("1.0", "end")
    set_status("Screen cleared")


SIMPLE_COMMANDS = {
    "help": cmd_help,
    "show memory": cmd_show_memory,
    "what time is it": cmd_time,
    "what is today's date": cmd_date,
    "what's today's date": cmd_date,
    "what is todays date": cmd_date,
    "whats todays date": cmd_date,
    "shutdown pc": cmd_shutdown,
    "restart pc": cmd_restart,
    "analyze image": cmd_analyze_image,
    "screenshot": cmd_screenshot,
    "analyze screen": cmd_screenshot,
    # comment
    "clear screen": cmd_clear_screen,
    "clear chat": cmd_clear_screen,
    "clear history": cmd_clear_history,
    "new chat": cmd_new_chat,
    "export chat": export_chat,
    "regenerate": lambda _msg: regenerate_last(),
    "stop": lambda _msg: stop_generation(),
}


def run_shutdown_action(action):
    system = platform.system()
    try:
        if system == "Windows":
            os.system("shutdown /s /t 0" if action == "shutdown" else "shutdown /r /t 0")
        elif system == "Darwin":
            os.system("osascript -e 'tell app \"System Events\" to shut down'"
                       if action == "shutdown" else
                       "osascript -e 'tell app \"System Events\" to restart'")
        else:
            os.system("shutdown now" if action == "shutdown" else "reboot")
        append_chat("Jarvis: Action confirmed.\n\n")
    except Exception as e:
        append_chat(f"[ERROR] Couldn't {action}: {e}\n\n", "error")


def handle_pending_confirmation(message):
    global pending_action
    if message.lower() == "yes":
        log_action(f"Confirmed {pending_action}")
        run_shutdown_action(pending_action)
        pending_action = None
        return True
    if message.lower() == "no":
        append_chat("Jarvis: Action cancelled.\n\n")
        pending_action = None
        return True
    return False


def handle_app_or_website(message):
    key = message.lower()
    if key in APP_COMMANDS:
        note, fn = APP_COMMANDS[key]
        log_action(note)
        try:
            fn()
            append_chat(f"[SYSTEM] > {note}\n\n", "system")
            speak(note)
        except Exception as e:
            append_chat(f"[ERROR] {e}\n\n", "error")
        return True
    if key in WEBSITE_COMMANDS:
        log_action(f"Opened {key}")
        webbrowser.open(WEBSITE_COMMANDS[key])
        append_chat(f"[SYSTEM] > Opening {key.split(' ', 1)[1]}...\n\n", "system")
        speak(f"Opening {key.split(' ', 1)[1]}")
        return True
    return False


def handle_memory_commands(message):
    lower = message.lower()

    if lower.startswith("remember "):
        info = message[9:]
        if "=" in info:
            key, value = info.split("=", 1)
            memory[key.strip()] = value.strip()
            save_memory(memory)
            log_action(f"Remembered {key.strip()} = {value.strip()}")
            append_chat(f"Jarvis: Saved memory -> {key.strip()} = {value.strip()}\n\n")
        else:
            append_chat("Jarvis: Use format remember key=value\n\n", "error")
        return True

    if lower.startswith("recall "):
        key = message[7:].strip()
        if key in memory:
            append_chat(f"Jarvis: {key} = {memory[key]}\n\n")
        else:
            append_chat("Jarvis: I don't know that yet.\n\n", "error")
        return True

    if lower.startswith("forget "):
        key = message[7:].strip()
        if key in memory:
            del memory[key]
            save_memory(memory)
            log_action(f"Forgot {key}")
            append_chat(f"Jarvis: Forgot {key}.\n\n")
        else:
            append_chat("Jarvis: I don't know that memory.\n\n", "error")
        return True

    return False


_input_history = []
_history_pos = None


def _history_move(delta):
    """Up/Down in the input box cycles through previously sent messages."""
    global _history_pos
    if not _input_history:
        return "break"
    if _history_pos is None:
        _history_pos = len(_input_history)
    _history_pos = max(0, min(len(_input_history), _history_pos + delta))
    entry.delete(0, "end")
    if _history_pos < len(_input_history):
        entry.insert(0, _input_history[_history_pos])
    return "break"


def send_message():
    global pending_action, _history_pos, _last_user_message
    if _ai_busy:
        return
    message = entry.get().strip()
    if not message:
        return
    entry.delete(0, "end")
    _hide_greeting()

    if not _input_history or _input_history[-1] != message:
        _input_history.append(message)
    _history_pos = None

    if pending_action and handle_pending_confirmation(message):
        return

    lower = message.lower()

    if lower in SIMPLE_COMMANDS:
        SIMPLE_COMMANDS[lower](message)
        refresh_recent()
        return

    if handle_memory_commands(message):
        refresh_recent()
        return

    if lower.startswith("search "):
        handle_search(message)
        return

    if handle_app_or_website(message):
        return

    # Normal chat -> Ollama. The user message goes into chat_history here,
    # not inside the worker thread — otherwise the Recent sidebar would
    # race the thread and omit the message you just sent.
    _hide_greeting()
    chat_history.append({"role": "user", "content": message})
    _last_user_message = message
    refresh_recent()
    append_chat(f"YOU · {_stamp()}\n", "user_meta")
    append_chat(f"{message}\n\n", "user")

    threading.Thread(target=get_ai_response,
                     args=(message,), kwargs={"is_regenerate": True},
                     daemon=True).start()


def enter_pressed(_event):
    send_message()
    return "break"


entry.bind("<Return>", enter_pressed)
entry.bind("<Up>", lambda e: _history_move(-1))
entry.bind("<Down>", lambda e: _history_move(1))

# Global keyboard shortcuts
app.bind("<Control-l>", lambda e: chat_box.delete("1.0", "end"))
app.bind("<Control-e>", lambda e: export_chat())
app.bind("<Control-m>", lambda e: toggle_voice())
app.bind("<Control-q>", lambda e: app.destroy())


# ============================================================
# Nav actions
# ============================================================

def boot_sequence():
    lines = [
        "═" * 42,
        "      J.A.R.V.I.S COMMAND TERMINAL",
        "═" * 42,
        "",
        "> Initializing AI Core...",
        "> Loading Memory...",
        "> Connecting Ollama...",
        "> Loading Vision Module...",
        "> Loading Voice Module...",
        "",
        "SYSTEM READY",
        "",
        "Awaiting your command...",
        "",
    ]
    chat_box.delete("1.0", "end")

    def write_line(i=0):
        if i >= len(lines):
            return
        line = lines[i]
        if line.startswith(">"):
            tag = "boot"
        elif "READY" in line:
            tag = "jarvis"
        elif "COMMAND TERMINAL" in line:
            tag = "system"
        else:
            tag = None
        chat_box.insert("end", line + "\n", tag)
        chat_box.see("end")
        app.after(220, lambda: write_line(i + 1))

    write_line()


QUICK_START = """
── quick start ──

•  Just type a question and hit Enter — e.g. "explain recursion simply"
•  Coding questions automatically use the qwen2.5-coder:7b model
•  Try:  remember my name=...   then later:  what's my name?
•  Click ＋ in the input bar to analyze an image or the screen
•  Click 🎤 (or speak) to dictate a message
•  Type "help" for the full command list

"""


def show_quick_start():
    append_chat(QUICK_START, "system")


def replay_history():
    """Shows the last few turns of a previous session so context isn't
    lost across restarts. Only called once, right after the initial
    boot animation finishes."""
    refresh_recent()
    if not chat_history:
        _show_greeting()
        show_quick_start()
        return
    _hide_greeting()
    append_chat("── previous conversation ──\n\n", "system")
    for msg in chat_history[-10:]:
        role = msg.get("role")
        content = msg.get("content", "")
        if role == "user":
            append_chat(f"YOU\n{content}\n\n", "user")
        elif role == "assistant":
            append_chat(f"JARVIS\n{content}\n\n", "jarvis")
    append_chat("── new messages below ──\n\n", "system")


def show_home():
    """Overview without wiping the on-screen chat (the old behavior reran the
    boot animation, which cleared everything you'd been reading)."""
    set_active_nav("home")
    append_chat(f"\n── home · {_stamp()} ──\n", "system")
    status = "online" if _ollama_online else "OFFLINE — is `ollama serve` running?"
    append_chat(
        f"Jarvis is {status}. Model: {current_model}. "
        f"Memory: {len(memory)} item(s). "
        f"History: {len(chat_history)} message(s).\n"
        f"Type 'help' for commands, or just ask me something.\n\n",
        "system",
    )


def show_chat():
    set_active_nav("chat")
    entry.focus()
    status_label.configure(text="Chat Mode")


def show_vision():
    set_active_nav("vision")
    threading.Thread(target=analyze_screenshot, daemon=True).start()


def show_memory():
    set_active_nav("memory")
    append_chat("\n========== MEMORY ==========\n", "system")
    if memory:
        for k, v in memory.items():
            append_chat(f"{k} : {v}\n", "jarvis")
    else:
        append_chat("No memory stored.\n", "error")
    append_chat("\n")


def clear_memory_confirm():
    memory.clear()
    save_memory(memory)
    append_chat("[SYSTEM] > Memory cleared.\n\n", "system")


def open_settings():
    set_active_nav("settings")
    win = ctk.CTkToplevel(app)
    win.title("Jarvis Settings")
    win.geometry("400x760")
    win.configure(fg_color=VOID)

    ctk.CTkLabel(win, text="SETTINGS", font=("Rajdhani", 20, "bold"),
                 text_color=CYAN).pack(pady=(20, 10))

    ctk.CTkLabel(win, text="Model", font=FONT_SUB, text_color=TEXT_DIM
                 ).pack(anchor="w", padx=24)

    def on_model_change(choice):
        set_current_model(choice)

    installed = get_installed_models()
    model_menu = ctk.CTkOptionMenu(
        win, values=["auto"] + (installed or AVAILABLE_MODELS[1:]),
        command=on_model_change,
        fg_color=PANEL_ALT, button_color=CYAN_DIM)
    model_menu.set(current_model)
    model_menu.pack(fill="x", padx=24, pady=(4, 16))

    # --- Vision model --------------------------------------------
    ctk.CTkLabel(win, text="Vision model (for image analysis)",
                 font=FONT_SUB, text_color=TEXT_DIM).pack(anchor="w", padx=24)

    vision_entry = ctk.CTkEntry(win, fg_color=PANEL_ALT, border_color=CYAN_DIM,
                                 text_color=TEXT_MAIN)
    vision_entry.insert(0, VISION_MODEL)
    vision_entry.pack(fill="x", padx=24, pady=(2, 16))

    def on_vision_change(_event=None):
        global VISION_MODEL
        val = vision_entry.get().strip()
        if val:
            VISION_MODEL = val
            set_status(f"Vision model set to {val}")

    vision_entry.bind("<FocusOut>", on_vision_change)
    vision_entry.bind("<Return>", on_vision_change)

    # --- Temperature -----------------------------------------------
    temp_label = ctk.CTkLabel(win, text=f"Temperature: {current_temperature:.1f}",
                               font=FONT_SUB, text_color=TEXT_DIM)
    temp_label.pack(anchor="w", padx=24)

    def on_temp_change(val):
        global current_temperature
        current_temperature = round(float(val), 1)
        temp_label.configure(text=f"Temperature: {current_temperature:.1f}")

    ctk.CTkSlider(win, from_=0.0, to=1.0, number_of_steps=10,
                  command=on_temp_change, progress_color=CYAN,
                  ).pack(fill="x", padx=24, pady=(2, 14))

    # --- Response length cap ----------------------------------------
    len_label = ctk.CTkLabel(
        win, text="Max response length (num_predict, -1 = unlimited)",
        font=FONT_SUB, text_color=TEXT_DIM)
    len_label.pack(anchor="w", padx=24)

    len_entry = ctk.CTkEntry(win, fg_color=PANEL_ALT, border_color=CYAN_DIM,
                              text_color=TEXT_MAIN)
    len_entry.insert(0, str(current_num_predict))
    len_entry.pack(fill="x", padx=24, pady=(2, 14))

    def on_len_change(_event=None):
        global current_num_predict
        try:
            current_num_predict = int(len_entry.get())
        except ValueError:
            current_num_predict = -1
            len_entry.delete(0, "end")
            len_entry.insert(0, "-1")

    len_entry.bind("<FocusOut>", on_len_change)
    len_entry.bind("<Return>", on_len_change)

    voice_switch = ctk.CTkSwitch(
        win, text="Speak replies aloud",
        command=lambda: set_voice_enabled(bool(voice_switch.get())))
    if _tts_enabled:
        voice_switch.select()
    voice_switch.pack(anchor="w", padx=24, pady=(0, 20))

    ctk.CTkButton(win, text="Export chat", fg_color=CYAN_DIM,
                  hover_color=CYAN, command=export_chat,
                  ).pack(fill="x", padx=24, pady=(0, 10))

    ctk.CTkButton(win, text="Clear stored memory", fg_color=RED,
                  hover_color="#B3364C", command=clear_memory_confirm,
                  ).pack(fill="x", padx=24, pady=(0, 10))

    ctk.CTkButton(win, text="Clear chat history", fg_color=RED,
                  hover_color="#B3364C", command=lambda: cmd_clear_history(""),
                  ).pack(fill="x", padx=24, pady=(0, 10))

    ctk.CTkLabel(win, text=f"Model keep-alive: {KEEP_ALIVE}  ·  "
                            f"Log file: {os.path.abspath(LOG_FILE)}",
                 font=FONT_MONO_SM, text_color=TEXT_DIM, wraplength=330,
                 ).pack(padx=24, pady=(10, 0))

    # Toplevels can sometimes spawn behind the main window depending on
    # the OS/window manager, making it look like the click did nothing.
    # Force it to the front once, then release "always on top" so it
    # doesn't stay pinned annoyingly.
    win.lift()
    win.focus_force()
    win.attributes("-topmost", True)
    win.after(250, lambda: win.attributes("-topmost", False))


# ============================================================
# Live system stats in the status pill
# ============================================================

def update_clock():
    cpu = psutil.cpu_percent()
    ram = psutil.virtual_memory()
    now = datetime.now().strftime("%H:%M:%S")
    if current_model == "auto" and _last_resolved_model:
        # No model resolved until the first message; show plain "auto"
        model_label = f"auto→{_last_resolved_model.split(':')[0]}"
    elif current_model == "auto":
        model_label = "auto"
    else:
        model_label = current_model
    conn = "ONLINE" if _ollama_online else "OFFLINE"
    status_pill_text.configure(
        text=f"{conn}  ·  {now}  ·  {model_label}  ·  CPU {cpu:.0f}%  ·  "
             f"RAM {ram.percent:.0f}%"
    )
    status_dot.configure(text_color=GREEN if _ollama_online else RED)
    update_status_bars()
    app.after(1000, update_clock)


# ============================================================
# Launch
# ============================================================

def _greeting():
    hour = datetime.now().hour
    daypart = "morning" if hour < 12 else "afternoon" if hour < 18 else "evening"
    name = memory.get("name") or memory.get("my name")
    who = f", {name}" if name else ""
    speak(f"Good {daypart}{who}. Jarvis online and ready.")


# Sidebar nav (settings pinned to the bottom) — created after the handlers
# exist, unlike the icon buttons which use lambdas.
make_nav_button("home", "Home", show_home, icon="◈")
make_nav_button("chat", "Chat", show_chat, icon="◈")
make_nav_button("vision", "Vision", show_vision, icon="◈")
make_nav_button("memory", "Memory", show_memory, icon="◈")
make_nav_button("settings", "Settings", open_settings, at_bottom=True, icon="◈")

# User card pinned under Settings (HUD touch from the reference)
_user_name = memory.get("name") or memory.get("my name") or "USER"
ctk.CTkLabel(sidebar, text=f"USER: {str(_user_name).upper()} · CLEARANCE: LEVEL 7",
             font=("Rajdhani", 10), text_color=AMBER
             ).pack(side="bottom", padx=12, pady=(4, 12))


if __name__ == "__main__":
    set_active_nav("home")
    boot_sequence()
    # Boot animation takes ~14 lines * 220ms; replay saved history right after,
    # which also decides whether to show the centered greeting overlay.
    app.after(3300, replay_history)
    update_clock()
    app.after(1000, _greeting)
    threading.Thread(target=check_and_warm_models, daemon=True).start()
    threading.Thread(target=_health_check_loop, daemon=True).start()
    entry.focus()
    app.mainloop()
