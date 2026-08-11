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
"""

import os
import sys
import json
import time
import queue
import platform
import threading
import webbrowser
from datetime import datetime
from tkinter import filedialog

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
    engine = pyttsx3.init()
    while True:
        text = _tts_queue.get()
        if _tts_enabled:
            engine.say(text)
            engine.runAndWait()


threading.Thread(target=_tts_worker, daemon=True).start()


def speak(text):
    if _tts_enabled:
        _tts_queue.put(text)


def take_screenshot():
    screenshot = pyautogui.screenshot()
    screenshot.save("current_screen.png")
    return "current_screen.png"


# ============================================================
# Theme tokens
# ============================================================

VOID = "#0A0E14"
PANEL = "#11151C"
PANEL_ALT = "#161B24"
CYAN = "#26E5FF"
CYAN_DIM = "#0F5D6E"
AMBER = "#FF9F1C"
GREEN = "#3CFF9E"
RED = "#FF4D6D"
TEXT_MAIN = "#E8F1F5"
TEXT_DIM = "#7C8B99"

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
# Avatar (falls back to a generated ring if the asset is missing)
# ============================================================

def load_avatar(size=140):
    path = resource_path("assets/jarvis_circle.png")
    try:
        img = Image.open(path).convert("RGBA")
    except Exception:
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        pad = 8
        draw.ellipse([pad, pad, size - pad, size - pad], outline=CYAN, width=5)
        draw.ellipse([pad + 22, pad + 22, size - pad - 22, size - pad - 22],
                     outline=AMBER, width=3)
        draw.ellipse([size // 2 - 6, size // 2 - 6, size // 2 + 6, size // 2 + 6],
                     fill=CYAN)
    return img.resize((size, size))


# ============================================================
# Sidebar
# ============================================================

sidebar = ctk.CTkFrame(app, width=160, fg_color=PANEL, corner_radius=0,
                        border_width=0)
sidebar.grid(row=0, column=0, sticky="nsw")
sidebar.grid_propagate(False)

ctk.CTkLabel(sidebar, text="◆ J.A.R.V.I.S", font=("Rajdhani", 17, "bold"),
             text_color=CYAN).pack(pady=(22, 4), padx=16, anchor="w")
ctk.CTkLabel(sidebar, text="control panel", font=("Rajdhani", 11),
             text_color=TEXT_DIM).pack(pady=(0, 20), padx=16, anchor="w")

nav_buttons = {}


def make_nav_button(key, label, command):
    btn = ctk.CTkButton(
        sidebar, text=label, font=FONT_NAV, anchor="w",
        fg_color="transparent", hover_color=PANEL_ALT,
        text_color=TEXT_DIM, corner_radius=8, height=38,
        command=command,
    )
    btn.pack(fill="x", padx=12, pady=4)
    nav_buttons[key] = btn
    return btn


def set_active_nav(key):
    for k, btn in nav_buttons.items():
        if k == key:
            btn.configure(fg_color=CYAN_DIM, text_color=CYAN)
        else:
            btn.configure(fg_color="transparent", text_color=TEXT_DIM)


# ============================================================
# Content column
# ============================================================

content = ctk.CTkFrame(app, fg_color=VOID, corner_radius=0)
content.grid(row=0, column=1, sticky="nsew")
content.grid_columnconfigure(0, weight=1)
content.grid_rowconfigure(1, weight=1)

# --- banner -------------------------------------------------
banner = ctk.CTkFrame(content, fg_color=PANEL, corner_radius=14,
                       border_width=1, border_color=CYAN_DIM, height=150)
banner.grid(row=0, column=0, sticky="ew", padx=18, pady=(18, 10))
banner.grid_propagate(False)
banner.grid_columnconfigure(1, weight=1)

avatar_img = ctk.CTkImage(light_image=load_avatar(), dark_image=load_avatar(),
                           size=(110, 110))
ctk.CTkLabel(banner, image=avatar_img, text="").grid(row=0, column=0, rowspan=2,
                                                       padx=20, pady=20)

ctk.CTkLabel(banner, text="J.A.R.V.I.S", font=FONT_DISPLAY,
             text_color=CYAN).grid(row=0, column=1, sticky="sw", pady=(20, 0))
ctk.CTkLabel(banner, text="Mark II · Personal AI Assistant", font=FONT_SUB,
             text_color=AMBER).grid(row=1, column=1, sticky="nw")

status_pill = ctk.CTkFrame(banner, fg_color=PANEL_ALT, corner_radius=20,
                            border_width=1, border_color=CYAN_DIM)
status_pill.grid(row=0, column=2, rowspan=2, padx=20)
status_dot = ctk.CTkLabel(status_pill, text="●", font=("Arial", 14),
                           text_color=GREEN)
status_dot.pack(side="left", padx=(14, 4), pady=10)
status_pill_text = ctk.CTkLabel(status_pill, text="ONLINE", font=FONT_MONO_SM,
                                 text_color=TEXT_MAIN)
status_pill_text.pack(side="left", padx=(0, 14), pady=10)

# --- chat log -------------------------------------------------
chat_box = ctk.CTkTextbox(content, font=FONT_MONO, fg_color=PANEL,
                           border_width=1, border_color=CYAN_DIM,
                           corner_radius=14, wrap="word")
chat_box.grid(row=1, column=0, sticky="nsew", padx=18, pady=8)

chat_box.tag_config("user", foreground=CYAN, justify="right", rmargin=16,
                     lmargin1=200, lmargin2=200, spacing1=10, spacing3=10)
chat_box.tag_config("jarvis", foreground=GREEN, justify="left", lmargin1=16,
                     lmargin2=16, rmargin=200, spacing1=10, spacing3=10)
chat_box.tag_config("system", foreground=AMBER, justify="center", spacing1=6,
                     spacing3=6)
chat_box.tag_config("error", foreground=RED, justify="left", spacing1=6,
                     spacing3=6)
chat_box.tag_config("code", foreground=AMBER, justify="left", lmargin1=24,
                     lmargin2=24, rmargin=24, spacing1=2, spacing3=2,
                     background=PANEL_ALT)

# --- status line -------------------------------------------------
status_label = ctk.CTkLabel(content, text="Ready", font=FONT_MONO_SM,
                             text_color=TEXT_DIM)
status_label.grid(row=2, column=0, sticky="w", padx=24, pady=(0, 4))

# --- input row -------------------------------------------------
bottom = ctk.CTkFrame(content, fg_color=PANEL, corner_radius=20,
                       border_width=1, border_color=CYAN_DIM)
bottom.grid(row=3, column=0, sticky="ew", padx=18, pady=(4, 18))
bottom.grid_columnconfigure(0, weight=1)

entry = ctk.CTkEntry(bottom, placeholder_text="> awaiting command...",
                      height=46, corner_radius=20, border_width=1,
                      border_color=CYAN_DIM, fg_color=PANEL_ALT,
                      text_color=TEXT_MAIN, placeholder_text_color=TEXT_DIM,
                      font=FONT_MONO)
entry.grid(row=0, column=0, sticky="ew", padx=(10, 6), pady=8)

btn_row = ctk.CTkFrame(bottom, fg_color="transparent")
btn_row.grid(row=0, column=1, padx=8)


def make_icon_button(parent, text, command, hover=CYAN_DIM):
    b = ctk.CTkButton(parent, text=text, width=42, height=42, corner_radius=21,
                       fg_color=PANEL_ALT, hover_color=hover,
                       border_width=1, border_color=CYAN_DIM,
                       text_color=TEXT_MAIN, font=("Consolas", 15, "bold"),
                       command=command)
    b.pack(side="left", padx=4)
    return b


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


_dot_state = True


def _pulse_status_dot():
    global _dot_state
    _dot_state = not _dot_state
    status_dot.configure(text_color=GREEN if _dot_state else CYAN_DIM)
    app.after(900, _pulse_status_dot)


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


_last_user_message = None
_last_assistant_reply = None


def get_ai_response(message, is_regenerate=False):
    """Streams the reply token-by-token instead of blocking until the whole
    thing is generated. This doesn't make the model itself faster, but it
    slashes *perceived* latency (you start reading immediately instead of
    staring at 'thinking...' for the entire generation) and lets you Stop
    a reply that's clearly going the wrong way instead of waiting it out."""
    global _ai_busy, _stop_generation, _last_user_message, _last_assistant_reply

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

    append_chat("╭" + "─" * 48 + "╮\n", "jarvis")

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
                in_code = _stream_insert(buffer, in_code)
                buffer = ""
                last_flush = now
            if part.get("done"):
                eval_count = part.get("eval_count")
                eval_duration = part.get("eval_duration")
        if buffer:
            in_code = _stream_insert(buffer, in_code)

        reply = "".join(reply_parts)
        append_chat("\n╰" + "─" * 48 + "╯\n\n", "jarvis")

        if reply.strip():
            chat_history.append({"role": "assistant", "content": reply})
            save_chat_history()
            _last_assistant_reply = reply

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


def toggle_voice():
    global _tts_enabled
    _tts_enabled = not _tts_enabled
    voice_button.configure(text="🔊" if _tts_enabled else "🔇")


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


APP_COMMANDS = {
    "open vscode": ("Opening VS Code...", open_vscode),
    "open edge": ("Opening Edge...", open_edge),
    "open downloads": ("Opening Downloads...", open_downloads),
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
- (or click the 🖼 button, or "Vision" in the sidebar for a screenshot)

Chat history:
- clear history         (wipes saved conversation history)
- export chat           (save the conversation as a .md file)

Conversation controls:
- regenerate             (redo the last answer / click 🔁)
- stop                   (cancel a reply mid-stream / click ■)
- (click 📋 to copy Jarvis's last reply to your clipboard)

Apps:
- open edge / open vscode / open downloads

Websites:
- open youtube / open github / open chatgpt

Utilities:
- what time is it
- whats todays date
- shutdown pc / restart pc

Notes:
- Replies now stream in live instead of appearing all at once.
- "Auto" model mode sticks with the coder model through a coding
  back-and-forth instead of reloading a different model every message.
- Model, temperature, response length, and keep-alive time are all
  adjustable from Settings.

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
    append_chat("Jarvis: Conversation history cleared.\n\n", "system")


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
    "clear history": cmd_clear_history,
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


def send_message():
    global pending_action
    if _ai_busy:
        return
    message = entry.get().strip()
    if not message:
        return
    entry.delete(0, "end")

    if pending_action and handle_pending_confirmation(message):
        return

    lower = message.lower()

    if lower in SIMPLE_COMMANDS:
        SIMPLE_COMMANDS[lower](message)
        return

    if handle_memory_commands(message):
        return

    if handle_app_or_website(message):
        return

    # Normal chat -> Ollama
    append_chat("╭" + "─" * 30 + "╮\n", "user")
    append_chat(f"│ {message}\n", "user")
    append_chat("╰" + "─" * 30 + "╯\n\n", "user")

    threading.Thread(target=get_ai_response, args=(message,), daemon=True).start()


def enter_pressed(_event):
    send_message()
    return "break"


entry.bind("<Return>", enter_pressed)

send_button = make_icon_button(btn_row, "➤", send_message)
mic_button = make_icon_button(btn_row, "🎤", listen_voice)
image_button = make_icon_button(btn_row, "🖼", pick_and_analyze_image)
voice_button = make_icon_button(btn_row, "🔊", toggle_voice)
regen_button = make_icon_button(btn_row, "🔁", lambda: regenerate_last())
copy_button = make_icon_button(btn_row, "📋", lambda: copy_last_response())
export_button = make_icon_button(btn_row, "💾", lambda: export_chat())
help_button = make_icon_button(btn_row, "❓", lambda: append_chat(
    "\nType 'help' to see all commands.\n\n", "system"))
clear_button = make_icon_button(btn_row, "🗑", lambda: chat_box.delete("1.0", "end"))


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
        tag = "user" if line.startswith(">") else \
              "jarvis" if "READY" in line else \
              "system" if "COMMAND TERMINAL" in line else None
        chat_box.insert("end", line + "\n", tag)
        chat_box.see("end")
        app.after(220, lambda: write_line(i + 1))

    write_line()


def replay_history():
    """Shows the last few turns of a previous session so context isn't
    lost across restarts. Only called once, right after the initial
    boot animation finishes."""
    if not chat_history:
        return
    append_chat("── previous conversation ──\n\n", "system")
    for msg in chat_history[-10:]:
        role = msg.get("role")
        content = msg.get("content", "")
        if role == "user":
            append_chat(f"> {content}\n", "user")
        elif role == "assistant":
            append_chat(f"{content}\n\n", "jarvis")
    append_chat("── new messages below ──\n\n", "system")


def show_home():
    set_active_nav("home")
    boot_sequence()


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
    win.geometry("400x620")
    win.configure(fg_color=VOID)

    ctk.CTkLabel(win, text="SETTINGS", font=("Rajdhani", 20, "bold"),
                 text_color=CYAN).pack(pady=(20, 10))

    ctk.CTkLabel(win, text="Model", font=FONT_SUB, text_color=TEXT_DIM
                 ).pack(anchor="w", padx=24)

    def on_model_change(choice):
        global current_model
        current_model = choice

    model_menu = ctk.CTkOptionMenu(win, values=AVAILABLE_MODELS,
                                    command=on_model_change,
                                    fg_color=PANEL_ALT, button_color=CYAN_DIM)
    model_menu.set(current_model)
    model_menu.pack(fill="x", padx=24, pady=(4, 16))

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

    ctk.CTkSwitch(win, text="Voice replies", command=toggle_voice,
                  onvalue=1, offvalue=0,
                  ).pack(anchor="w", padx=24, pady=(0, 20))

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


make_nav_button("home", "Home", show_home)
make_nav_button("chat", "Chat", show_chat)
make_nav_button("vision", "Vision", show_vision)
make_nav_button("memory", "Memory", show_memory)
make_nav_button("settings", "Settings", open_settings)


# ============================================================
# Live system stats in the status pill / footer
# ============================================================

def update_clock():
    cpu = psutil.cpu_percent()
    ram = psutil.virtual_memory()
    now = datetime.now().strftime("%H:%M:%S")
    model_label = current_model if current_model != "auto" else "auto"
    status_pill_text.configure(
        text=f"{now}  ·  {model_label}  ·  CPU {cpu:.0f}%  ·  "
             f"RAM {ram.percent:.0f}%"
    )
    app.after(1000, update_clock)


# ============================================================
# Launch
# ============================================================

if __name__ == "__main__":
    set_active_nav("home")
    boot_sequence()
    # Boot animation takes ~14 lines * 220ms; replay saved history right after.
    app.after(3300, replay_history)
    update_clock()
    _pulse_status_dot()
    app.after(1000, lambda: speak("Jarvis online and ready."))
    threading.Thread(target=check_and_warm_models, daemon=True).start()
    entry.focus()
    app.mainloop()
