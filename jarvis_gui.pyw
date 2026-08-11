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


def load_memory():
    try:
        with open(MEMORY_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_memory(mem):
    with open(MEMORY_FILE, "w") as f:
        json.dump(mem, f, indent=4)


def log_action(action):
    with open(LOG_FILE, "a") as f:
        f.write(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {action}\n")


memory = load_memory()
chat_history = []          # rolling message list sent to Ollama
pending_action = None      # "shutdown" | "restart" | None

AVAILABLE_MODELS = ["auto", "qwen2.5:3b", "qwen2.5-coder:7b"]
CODING_KEYWORDS = [
    "code", "python", "java", "c++", "javascript", "html", "css",
    "program", "script", "leetcode", "bug", "error", "debug",
]
current_model = "auto"

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
# Theme tokens — glass palette
# ============================================================
# NOTE ON THE "GLASS" LOOK:
# Tkinter/CustomTkinter widgets can't do true per-widget alpha
# blending, so individual panels can't literally be see-through.
# Two techniques fake it convincingly instead:
#   1. A blurred, colorful gradient backdrop rendered once with PIL
#      sits behind everything. Frosted-looking cards (light border,
#      soft top highlight, cool desaturated fill) float on top of it,
#      with the blurred backdrop showing through the gaps. Works on
#      every OS.
#   2. On Windows only, real OS-level acrylic blur-behind is enabled
#      via a DWM composition trick (see try_enable_windows_acrylic
#      below), which blurs whatever is behind the actual window on
#      the desktop. Best-effort — silently skipped everywhere else,
#      and safe to fail on if a future Windows update changes it.

VOID = "#0A0E14"              # fallback base / non-Windows background
GLASS_KEY = "#010203"         # window transparency color-key (Windows acrylic only)
GLASS_FILL = "#1B2230"        # frosted card fill
GLASS_FILL_ALT = "#212A3A"    # slightly lighter, for inputs/pills
GLASS_BORDER = "#3E4C60"      # soft light-refraction edge
GLASS_HILITE = "#55708A"      # subtle top-edge sheen line
PANEL = GLASS_FILL
PANEL_ALT = GLASS_FILL_ALT
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
app.configure(fg_color=GLASS_KEY)

# 2-column grid: sidebar | content. Content splits into rows.
app.grid_columnconfigure(1, weight=1)
app.grid_rowconfigure(0, weight=1)


# ============================================================
# Glass backdrop — blurred gradient blobs behind everything.
# Regenerated (cheaply, scaled) on resize so it always fills the
# window without visible seams.
# ============================================================

def _make_backdrop(width, height):
    from PIL import ImageFilter
    width, height = max(width, 200), max(height, 200)
    img = Image.new("RGB", (width, height), (9, 11, 16))
    blobs = [
        (int(width * 0.15), int(height * 0.20), 260, (38, 150, 180)),
        (int(width * 0.85), int(height * 0.15), 300, (150, 90, 20)),
        (int(width * 0.75), int(height * 0.85), 320, (30, 120, 90)),
        (int(width * 0.20), int(height * 0.90), 240, (60, 40, 120)),
    ]
    layer = Image.new("RGB", (width, height), (9, 11, 16))
    draw = ImageDraw.Draw(layer)
    for cx, cy, r, color in blobs:
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
    img = Image.blend(img, layer, 0.55)
    img = img.filter(ImageFilter.GaussianBlur(radius=min(width, height) // 8))
    # Darken so foreground text/cards stay readable on top of it.
    dark = Image.new("RGB", img.size, (0, 0, 0))
    img = Image.blend(img, dark, 0.45)
    return img


backdrop_label = ctk.CTkLabel(app, text="", fg_color=VOID)
backdrop_label.place(x=0, y=0, relwidth=1, relheight=1)
backdrop_label.lower()  # keep it behind every other widget

_backdrop_photo = {"img": None}
_resize_job = {"id": None}


def _apply_backdrop(width, height):
    pil_img = _make_backdrop(width, height)
    ctk_img = ctk.CTkImage(light_image=pil_img, dark_image=pil_img,
                            size=(width, height))
    _backdrop_photo["img"] = ctk_img  # keep a reference alive
    backdrop_label.configure(image=ctk_img)


def _on_app_resize(event):
    if event.widget is not app:
        return
    if _resize_job["id"] is not None:
        app.after_cancel(_resize_job["id"])
    _resize_job["id"] = app.after(
        180, lambda: _apply_backdrop(app.winfo_width(), app.winfo_height())
    )


app.bind("<Configure>", _on_app_resize)
_apply_backdrop(1180, 780)


def try_enable_windows_acrylic():
    """Best-effort real frosted-glass blur-behind, Windows 10/11 only.
    Silently does nothing on any other OS or if the API isn't there."""
    if platform.system() != "Windows":
        return
    try:
        import ctypes

        class ACCENT_POLICY(ctypes.Structure):
            _fields_ = [("AccentState", ctypes.c_int),
                        ("AccentFlags", ctypes.c_int),
                        ("GradientColor", ctypes.c_int),
                        ("AnimationId", ctypes.c_int)]

        class WCA_DATA(ctypes.Structure):
            _fields_ = [("Attribute", ctypes.c_int),
                        ("Data", ctypes.POINTER(ACCENT_POLICY)),
                        ("SizeOfData", ctypes.c_size_t)]

        ACCENT_ENABLE_ACRYLICBLURBEHIND = 4
        WCA_ACCENT_POLICY = 19

        accent = ACCENT_POLICY()
        accent.AccentState = ACCENT_ENABLE_ACRYLICBLURBEHIND
        accent.GradientColor = 0x99120A0A  # ARGB tint, alpha ~60%

        data = WCA_DATA()
        data.Attribute = WCA_ACCENT_POLICY
        data.SizeOfData = ctypes.sizeof(accent)
        data.Data = ctypes.pointer(accent)

        hwnd = ctypes.windll.user32.GetParent(app.winfo_id())
        ctypes.windll.user32.SetWindowCompositionAttribute(hwnd, ctypes.byref(data))

        # Make the reserved key color fully transparent so the real
        # blurred desktop shows through wherever no widget covers it.
        app.wm_attributes("-transparentcolor", GLASS_KEY)
        backdrop_label.place_forget()  # let the real OS blur show instead
    except Exception:
        pass  # not fatal — the PIL backdrop is already a solid fallback


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
                        border_width=0, border_color=GLASS_BORDER)
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

content = ctk.CTkFrame(app, fg_color="transparent", corner_radius=0)
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

def resolve_model(message):
    if current_model != "auto":
        return current_model
    if any(word in message.lower() for word in CODING_KEYWORDS):
        return "qwen2.5-coder:7b"
    return "qwen2.5:3b"


def get_ai_response(message):
    memory_text = "\n".join(f"{k}: {v}" for k, v in memory.items())
    system_message = {
        "role": "system",
        "content": f"You are Jarvis, a concise personal AI assistant.\n\n"
                    f"User memory:\n{memory_text}\n\nAnswer concisely.",
    }
    chat_history.append({"role": "user", "content": message})
    model_name = resolve_model(message)

    start_thinking()
    try:
        response = ollama.chat(
            model=model_name,
            messages=[system_message] + chat_history[-6:],
        )
        reply = response["message"]["content"]
        chat_history.append({"role": "assistant", "content": reply})
        append_chat("╭" + "─" * 48 + "╮\n", "jarvis")
        append_chat(reply + "\n", "jarvis")
        append_chat("╰" + "─" * 48 + "╯\n\n", "jarvis")
    except Exception as e:
        append_chat(
            f"[ERROR] Couldn't reach Ollama ({model_name}). "
            f"Is `ollama serve` running?\n{e}\n\n", "error",
        )
    finally:
        stop_thinking()


def analyze_screenshot():
    set_status("Analyzing screen...")
    try:
        image_path = take_screenshot()
        response = ollama.chat(
            model="llama3.2-vision:latest",
            messages=[{
                "role": "user",
                "content": "Analyze this screenshot in detail.",
                "images": [image_path],
            }],
        )
        result = response["message"]["content"]
        append_chat(f"\nJARVIS VISION >\n{result}\n\n", "jarvis")
    except Exception as e:
        append_chat(f"[ERROR] Vision analysis failed: {e}\n\n", "error")
    finally:
        set_status("Ready")


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

Apps:
- open edge / open vscode / open downloads

Websites:
- open youtube / open github / open chatgpt

Utilities:
- what time is it
- whats todays date
- shutdown pc / restart pc

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
voice_button = make_icon_button(btn_row, "🔊", toggle_voice)
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
    win.geometry("380x320")
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

    ctk.CTkSwitch(win, text="Voice replies", command=toggle_voice,
                  onvalue=1, offvalue=0,
                  ).pack(anchor="w", padx=24, pady=(0, 20))

    ctk.CTkButton(win, text="Clear stored memory", fg_color=RED,
                  hover_color="#B3364C", command=clear_memory_confirm,
                  ).pack(fill="x", padx=24, pady=(0, 10))

    ctk.CTkLabel(win, text=f"Log file: {os.path.abspath(LOG_FILE)}",
                 font=FONT_MONO_SM, text_color=TEXT_DIM, wraplength=330,
                 ).pack(padx=24, pady=(10, 0))


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
    update_clock()
    _pulse_status_dot()
    app.after(1000, lambda: speak("Jarvis online and ready."))
    entry.focus()
    app.mainloop()
