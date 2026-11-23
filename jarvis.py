#!/usr/bin/env python3
"""
SPDX-License-Identifier: MIT
Copyright (c) 2026 cosmoknight — J.A.R.V.I.S Terminal Assistant

Direct command-prompt AI assistant powered by local Ollama (no localhost web server required).
Features:
  - Live token-by-token streaming chat with Ctrl+C cancellation (closes Ollama stream cleanly)
  - Sticky auto-routing between general (qwen2.5:3b) and coding (qwen2.5-coder:7b) models
  - Fast /api/tags reachability probe, bounded num_ctx=4096, and short keep_alive to prevent hangs
  - Built-in Xslide .pptx generator (/ppt or natural "create a 6-slide presentation..." prompts)
    with prompt slide-count override, strict JSON validation + 1-shot retry, native tables,
    and guaranteed PowerPoint speaker notes
  - Persistent key=value memory (memory.json) and chat history (chat_history.json)

Run directly from Command Prompt / PowerShell:
    python jarvis.py
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Ensure repo root is importable when invoked from any working directory
REPO_ROOT = Path(__file__).resolve().parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.ollama_pptx_generator import (  # noqa: E402
    build_pptx_from_deck,
    call_local_ollama,
    generate_validated_deck_json,
    parse_slide_count_override,
)

ATTRIBUTION_SHORT = "J.A.R.V.I.S (c) 2026 cosmoknight"
DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434"
DEFAULT_GENERAL_MODEL = "qwen2.5:3b"
DEFAULT_CODING_MODEL = "qwen2.5-coder:7b"
DEFAULT_SLIDE_MODEL = "vai-doc:latest"
DEFAULT_SLIDE_PRESET = 8
MAX_CONTEXT_MESSAGES = 8
MAX_HISTORY_MESSAGES = 200

MEMORY_FILE = REPO_ROOT / "memory.json"
HISTORY_FILE = REPO_ROOT / "chat_history.json"

CODING_KEYWORDS = (
    "python",
    "code",
    "debug",
    "error",
    "traceback",
    "exception",
    "syntax",
    "bug",
    "fix",
    "function",
    "def ",
    "class ",
    "import ",
    "javascript",
    "typescript",
    "react",
    "sql",
    "html",
    "css",
    "regex",
    "algorithm",
    "compile",
    "script",
    "stack trace",
    "nullpointer",
    "indexerror",
    "typeerror",
    "valueerror",
    "keyerror",
    "nameerror",
    "indentationerror",
    "```",
)


def _enable_utf8_console() -> None:
    """Prevents UnicodeEncodeError on Windows cp1252 terminals."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def load_json_file(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def save_json_file(path: Path, data: Any) -> None:
    try:
        with path.open("w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as exc:
        print(f"[Warn] Could not save {path.name}: {exc}")


def check_ollama(host: str, timeout: float = 2.0) -> Tuple[bool, List[str], str]:
    """Fast /api/tags health check returning (reachable, installed_models, error_message)."""
    url = f"{host.rstrip('/')}/api/tags"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            models = [
                str(m.get("name", "")).strip()
                for m in payload.get("models", [])
                if isinstance(m, dict) and m.get("name")
            ]
            return True, models, ""
    except Exception as exc:
        return False, [], str(exc)


def resolve_model_tag(requested: str, installed: List[str]) -> str:
    """Matches exact tag, :latest alias, base name prefix, or falls back to first installed."""
    req = (requested or "").strip()
    if not installed:
        return req or DEFAULT_GENERAL_MODEL

    lower_map = {m.lower(): m for m in installed}
    if req.lower() in lower_map:
        return lower_map[req.lower()]

    if ":" not in req and f"{req.lower()}:latest" in lower_map:
        return lower_map[f"{req.lower()}:latest"]

    req_base = req.lower().split(":")[0]
    for m in installed:
        if m.lower().split(":")[0] == req_base:
            return m

    return installed[0]


def is_coding_prompt(text: str) -> bool:
    lower = (text or "").lower()
    return any(kw in lower for kw in CODING_KEYWORDS)


def choose_model(
    prompt: str,
    selected_mode: str,
    sticky_coding: bool,
    general_model: str = DEFAULT_GENERAL_MODEL,
    coding_model: str = DEFAULT_CODING_MODEL,
) -> Tuple[str, bool]:
    """
    Resolves which Ollama model to use.
    In 'auto' mode, routes coding/debugging prompts to coding_model and stays sticky
    for follow-ups until /clear or explicit switch.
    """
    mode = (selected_mode or "auto").strip()
    if mode.lower() != "auto":
        return mode, sticky_coding

    if sticky_coding or is_coding_prompt(prompt):
        return coding_model, True
    return general_model, False


def parse_ndjson_line(line: str) -> Tuple[str, bool, Optional[str]]:
    """Parses one Ollama streaming NDJSON line -> (token_text, is_done, error_message)."""
    trimmed = (line or "").strip()
    if not trimmed:
        return "", False, None
    try:
        obj = json.loads(trimmed)
    except json.JSONDecodeError:
        return "", False, None

    if not isinstance(obj, dict):
        return "", False, None

    if obj.get("error"):
        return "", True, str(obj["error"])

    msg = obj.get("message")
    token = ""
    if isinstance(msg, dict) and isinstance(msg.get("content"), str):
        token = msg["content"]
    elif isinstance(obj.get("response"), str):
        token = obj["response"]

    return token, bool(obj.get("done")), None


def detect_ppt_request(user_input: str) -> Optional[str]:
    """
    Detects explicit /ppt, /slide, /xslide commands or natural presentation requests.
    Returns the prompt text to pass to the PPT generator, or None for normal chat.
    """
    text = (user_input or "").strip()
    if not text:
        return None

    cmd_match = re.match(r"^/(?:ppt|pptx|slide|slides|xslide)\b\s*(.*)$", text, flags=re.I)
    if cmd_match:
        return cmd_match.group(1).strip()

    natural_match = re.search(
        r"\b(?:create|generate|make|build)\s+(?:a\s+|an\s+|me\s+a\s+)?(?:\d{1,2}\s*[-\s]?\s*slides?\s+)?(?:presentation|powerpoint|pptx|ppt|slide\s+deck|slides)\b",
        text,
        flags=re.I,
    )
    if natural_match:
        return text

    return None


def sanitize_filename(title: str, default_stem: str = "jarvis_deck") -> str:
    stem = re.sub(r"[^a-zA-Z0-9_-]+", "_", (title or "").strip()).strip("_").lower()
    if not stem:
        stem = default_stem
    return f"{stem[:50]}.pptx"


def build_system_prompt(memory: Dict[str, str]) -> str:
    base = (
        "You are J.A.R.V.I.S, a concise, technically accurate local desktop AI assistant. "
        "When debugging code, identify the exact root cause first, show the minimal corrected code, "
        "and avoid unnecessary filler."
    )
    if not memory:
        return base
    facts = "\n".join(f"- {k}: {v}" for k, v in memory.items())
    return f"{base}\n\nKnown user facts (memory):\n{facts}"


def stream_ollama_chat(
    host: str,
    model: str,
    messages: List[Dict[str, str]],
    keep_alive: str = "5m",
    num_ctx: int = 4096,
    read_timeout: float = 90.0,
) -> Tuple[str, float, Optional[float], bool]:
    """
    Streams a chat completion from local Ollama directly to stdout.
    Returns (full_reply, total_elapsed_sec, ttft_sec, was_interrupted).
    """
    url = f"{host.rstrip('/')}/api/chat"
    payload = {
        "model": model,
        "stream": True,
        "keep_alive": keep_alive,
        "options": {
            "num_ctx": num_ctx,
            "temperature": 0.3,
        },
        "messages": messages,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    started = time.perf_counter()
    ttft: Optional[float] = None
    chunks: List[str] = []
    interrupted = False

    resp = None
    try:
        resp = urllib.request.urlopen(req, timeout=read_timeout)
        while True:
            raw_line = resp.readline()
            if not raw_line:
                break
            line = raw_line.decode("utf-8", errors="replace")
            token, done, err = parse_ndjson_line(line)
            if err:
                raise RuntimeError(f"Ollama error: {err}")
            if token:
                if ttft is None:
                    ttft = time.perf_counter() - started
                chunks.append(token)
                sys.stdout.write(token)
                sys.stdout.flush()
            if done:
                break
    except KeyboardInterrupt:
        interrupted = True
        sys.stdout.write("\n[Stopped by user]\n")
        sys.stdout.flush()
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace").strip()
        except Exception:
            pass
        raise RuntimeError(f"Ollama HTTP {exc.code}: {body or exc.reason}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not reach Ollama at {host}: {exc.reason}") from exc
    except TimeoutError as exc:
        raise RuntimeError(
            f"Ollama timed out after {int(read_timeout)}s waiting for {model}. "
            "Check `ollama ps` — unloading unused models or lowering keep_alive fixes RAM thrashing."
        ) from exc
    finally:
        if resp is not None:
            try:
                resp.close()
            except Exception:
                pass

    elapsed = time.perf_counter() - started
    return "".join(chunks), elapsed, ttft, interrupted


def print_help() -> None:
    print(
        "\nCommands:\n"
        "  /help                     Show this command reference\n"
        "  /model [auto|<tag>]       Switch model (default: auto -> qwen2.5:3b / qwen2.5-coder:7b)\n"
        "  /slidemodel [tag]         View or set Xslide PPT model (default: vai-doc:latest)\n"
        "  /preset <2-20>            Set default slide count preset (overridden if prompt states count)\n"
        "  /ppt <topic>              Generate a 16:9 .pptx deck (native tables + speaker notes)\n"
        "  /models                   List locally installed Ollama models\n"
        "  remember key=value        Save a persistent fact to memory.json\n"
        "  memory                    Show saved memory facts\n"
        "  forget <key>              Remove a memory key\n"
        "  /clear                    Reset current chat context & sticky code routing\n"
        "  /exit                     Quit J.A.R.V.I.S\n"
        "\nTip: Press Ctrl+C while a reply is streaming to stop generation immediately.\n"
    )


def handle_ppt_generation(
    ppt_prompt: str,
    preset_slides: int,
    slide_model: str,
    host: str,
    installed_models: List[str],
) -> None:
    if not ppt_prompt:
        print("Usage: /ppt Create a 6-slide presentation on B-Trees vs LSM-Trees with a comparison table")
        return

    resolved_model = resolve_model_tag(slide_model, installed_models)
    target_slides, overridden = parse_slide_count_override(ppt_prompt, preset_slides)
    source_note = "overridden from prompt" if overridden else "default preset"
    print(
        f"\n[Xslide] Generating {target_slides}-slide deck ({source_note}) "
        f"using {resolved_model}..."
    )

    started = time.perf_counter()
    try:
        deck = generate_validated_deck_json(
            user_prompt=ppt_prompt,
            preset_num_slides=preset_slides,
            call_ollama_fn=lambda sys_p, usr_p: call_local_ollama(
                sys_p, usr_p, model=resolved_model, host=host
            ),
        )
        out_name = sanitize_filename(deck.get("title", "jarvis_deck"))
        out_path = str(Path.cwd() / out_name)
        saved = build_pptx_from_deck(deck, out_path)
        elapsed = time.perf_counter() - started
        print(f"[Xslide] Saved {len(deck['slides'])} slides (with speaker notes) -> {saved} ({elapsed:.1f}s)\n")
    except ModuleNotFoundError as exc:
        if "pptx" in str(exc):
            print("[Xslide] Missing dependency `python-pptx`. Install it once with:\n  pip install python-pptx\n")
        else:
            print(f"[Xslide Error] {exc}\n")
    except Exception as exc:
        print(f"[Xslide Error] {exc}\n")


def run_cli(args: argparse.Namespace) -> int:
    _enable_utf8_console()

    host = args.host.rstrip("/")
    selected_mode = args.model
    general_model = args.general_model
    coding_model = args.coding_model
    slide_model = args.slide_model
    slide_preset = max(2, min(20, args.preset))
    keep_alive = args.keep_alive
    num_ctx = args.num_ctx

    memory: Dict[str, str] = load_json_file(MEMORY_FILE, {})
    if not isinstance(memory, dict):
        memory = {}

    history: List[Dict[str, str]] = load_json_file(HISTORY_FILE, [])
    if not isinstance(history, list):
        history = []

    reachable, installed, err = check_ollama(host)
    print("=" * 68)
    print(f"  {ATTRIBUTION_SHORT}  |  Direct Python Terminal CLI")
    print("=" * 68)
    if reachable:
        print(f"  Ollama  : ONLINE ({host}) · {len(installed)} model(s) installed")
        if installed:
            print(f"  Models  : {', '.join(installed[:6])}{' ...' if len(installed) > 6 else ''}")
    else:
        print(f"  Ollama  : OFFLINE ({host}) — {err}")
        print("  Tip     : Start Ollama (`ollama serve`) in another terminal.")
    print(f"  Chat    : {selected_mode} (general={general_model}, coding={coding_model}, ctx={num_ctx})")
    print(f"  Xslide  : {slide_model} (default preset={slide_preset} slides)")
    print("  Help    : Type /help for commands, /ppt <topic> for slides, /exit to quit.")
    print("=" * 68 + "\n")

    # Optional one-shot prompt mode: `python jarvis.py -p "Find the bug in..."`
    if args.prompt:
        user_input = args.prompt.strip()
        ppt_prompt = detect_ppt_request(user_input)
        if ppt_prompt is not None:
            handle_ppt_generation(ppt_prompt, slide_preset, slide_model, host, installed)
            return 0
        target, _ = choose_model(user_input, selected_mode, False, general_model, coding_model)
        resolved = resolve_model_tag(target, installed)
        msgs = [
            {"role": "system", "content": build_system_prompt(memory)},
            {"role": "user", "content": user_input},
        ]
        print(f"[J.A.R.V.I.S · {resolved}]")
        reply, elapsed, ttft, _ = stream_ollama_chat(
            host, resolved, msgs, keep_alive=keep_alive, num_ctx=num_ctx
        )
        ttft_s = f"TTFT {ttft:.1f}s · " if ttft is not None else ""
        print(f"\n({ttft_s}{elapsed:.1f}s)\n")
        return 0 if reply else 1

    sticky_coding = False
    context: List[Dict[str, str]] = history[-MAX_CONTEXT_MESSAGES:]

    while True:
        try:
            user_input = input("You > ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye, Sir.")
            break

        if not user_input:
            continue

        lower = user_input.lower()
        if lower in {"/exit", "/quit", "exit", "quit"}:
            print("Goodbye, Sir.")
            break

        if lower in {"/help", "help"}:
            print_help()
            continue

        if lower == "/clear":
            context = []
            sticky_coding = False
            print("[Chat context cleared and sticky code routing reset]\n")
            continue

        if lower == "/models":
            reachable, installed, err = check_ollama(host)
            if reachable:
                print("Installed Ollama models:", ", ".join(installed) if installed else "(none)")
            else:
                print(f"[Offline] Could not reach {host}: {err}")
            print()
            continue

        if lower.startswith("/model"):
            parts = user_input.split(maxsplit=1)
            if len(parts) == 1:
                print(f"Active model mode: {selected_mode}\n")
            else:
                selected_mode = parts[1].strip()
                sticky_coding = False
                print(f"Switched chat model to: {selected_mode}\n")
            continue

        if lower.startswith("/slidemodel"):
            parts = user_input.split(maxsplit=1)
            if len(parts) == 1:
                print(f"Active Xslide model: {slide_model}\n")
            else:
                slide_model = parts[1].strip()
                print(f"Switched Xslide model to: {slide_model}\n")
            continue

        if lower.startswith("/preset"):
            parts = user_input.split(maxsplit=1)
            if len(parts) == 2 and parts[1].strip().isdigit():
                slide_preset = max(2, min(20, int(parts[1].strip())))
                print(f"Default Xslide preset set to: {slide_preset} slides\n")
            else:
                print(f"Current Xslide preset: {slide_preset} slides (usage: /preset 8)\n")
            continue

        # Memory commands
        if lower == "memory":
            if not memory:
                print("Memory is empty. Use `remember key=value` to save facts.\n")
            else:
                for k, v in memory.items():
                    print(f"  {k} = {v}")
                print()
            continue

        rem_match = re.match(r"^remember\s+([^=]+?)\s*=\s*(.+)$", user_input, flags=re.I)
        if rem_match:
            k, v = rem_match.group(1).strip(), rem_match.group(2).strip()
            memory[k] = v
            save_json_file(MEMORY_FILE, memory)
            print(f"[Memory saved] {k} = {v}\n")
            continue

        fgt_match = re.match(r"^forget\s+(.+)$", user_input, flags=re.I)
        if fgt_match:
            k = fgt_match.group(1).strip()
            if k in memory:
                del memory[k]
                save_json_file(MEMORY_FILE, memory)
                print(f"[Memory removed] {k}\n")
            else:
                print(f"[Memory] Key not found: {k}\n")
            continue

        # Refresh Ollama connectivity cleanly before running inference
        reachable, installed, err = check_ollama(host)
        if not reachable:
            print(f"[Offline] Cannot reach local Ollama at {host}: {err}")
            print("Make sure Ollama is running (`ollama serve`) and try again.\n")
            continue

        # Xslide PPT generation command or natural prompt
        ppt_prompt = detect_ppt_request(user_input)
        if ppt_prompt is not None:
            handle_ppt_generation(ppt_prompt, slide_preset, slide_model, host, installed)
            continue

        # Normal streaming chat with auto-routing
        chosen, sticky_coding = choose_model(
            user_input, selected_mode, sticky_coding, general_model, coding_model
        )
        resolved = resolve_model_tag(chosen, installed)

        req_messages: List[Dict[str, str]] = [
            {"role": "system", "content": build_system_prompt(memory)},
            *context[-MAX_CONTEXT_MESSAGES:],
            {"role": "user", "content": user_input},
        ]

        print(f"\nJ.A.R.V.I.S ({resolved}) > ", end="", flush=True)
        try:
            reply, elapsed, ttft, interrupted = stream_ollama_chat(
                host=host,
                model=resolved,
                messages=req_messages,
                keep_alive=keep_alive,
                num_ctx=num_ctx,
            )
            ttft_part = f"TTFT {ttft:.1f}s · " if ttft is not None else ""
            print(f"\n[{ttft_part}{elapsed:.1f}s]\n")

            if reply.strip():
                context.append({"role": "user", "content": user_input})
                context.append({"role": "assistant", "content": reply})
                context = context[-MAX_CONTEXT_MESSAGES:]

                history.append({"role": "user", "content": user_input})
                history.append({"role": "assistant", "content": reply})
                history = history[-MAX_HISTORY_MESSAGES:]
                save_json_file(HISTORY_FILE, history)
        except Exception as exc:
            print(f"\n[Error] {exc}\n")

    return 0


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="J.A.R.V.I.S direct Python terminal chatbot (local Ollama, no web server)."
    )
    parser.add_argument(
        "--model",
        default="auto",
        help="Chat model or 'auto' (routes between qwen2.5:3b & qwen2.5-coder:7b)",
    )
    parser.add_argument("--general-model", default=DEFAULT_GENERAL_MODEL)
    parser.add_argument("--coding-model", default=DEFAULT_CODING_MODEL)
    parser.add_argument("--slide-model", default=DEFAULT_SLIDE_MODEL)
    parser.add_argument("--preset", type=int, default=DEFAULT_SLIDE_PRESET)
    parser.add_argument("--host", default=DEFAULT_OLLAMA_HOST)
    parser.add_argument("--keep-alive", default="5m", help="Ollama model keep_alive (default: 5m)")
    parser.add_argument("--num-ctx", type=int, default=4096, help="Context window cap (default: 4096)")
    parser.add_argument("-p", "--prompt", default="", help="Optional single-turn prompt and exit")
    return parser.parse_args(argv)


if __name__ == "__main__":
    sys.exit(run_cli(parse_args()))
