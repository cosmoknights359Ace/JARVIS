#!/usr/bin/env python3
"""
SPDX-License-Identifier: MIT
Copyright (c) 2026 cosmoknight — J.A.R.V.I.S Native Desktop Launcher

Single-command desktop launcher for the TypeScript/React J.A.R.V.I.S GUI.
Starts the unified Node/Express + Vite/dist server (`server.ts`), waits for
`/api/jarvis/health`, opens the app inside a native `pywebview` window titled
"JARVIS", and cleanly terminates the entire child process tree on exit
(including Windows Job Object + `taskkill /T /F` cleanup so zero orphan
Node/Vite processes remain).

Usage:
    python jarvis_gui.py
    python jarvis_gui.py --dev      # Force Vite dev middleware mode
    python jarvis_gui.py --prod     # Force compiled dist/ mode (builds if missing)
    python jarvis_gui.py --debug    # Open WebView developer tools
"""

from __future__ import annotations

import argparse
import atexit
import base64
import collections
import ctypes
import inspect
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Deque, Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent
WINDOW_TITLE = "JARVIS"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 3000
DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434"
DEFAULT_STARTUP_TIMEOUT_SEC = 45.0
WINDOW_BG_HEX = "#070709"

IS_WINDOWS = sys.platform == "win32"


def _enable_utf8_console() -> None:
    """Avoid UnicodeEncodeError on Windows cp1252 terminals."""
    for stream in (sys.stdout, sys.stderr):
        if stream is not None and hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def parse_dotenv(dotenv_path: Path) -> Dict[str, str]:
    """
    Parses a simple KEY=VALUE .env file without external dependencies.
    Never logs values.
    """
    parsed: Dict[str, str] = {}
    if not dotenv_path.is_file():
        return parsed

    try:
        raw_lines = dotenv_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return parsed

    for raw_line in raw_lines:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip()
        if not key:
            continue
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
            val = val[1:-1]
        parsed[key] = val

    return parsed


def get_webview_storage_dir() -> Path:
    """
    Returns an OS-appropriate persistent directory for WebView2 / pywebview
    storage so J.A.R.V.I.S localStorage (chat history, memory, settings)
    persists cleanly across desktop restarts without polluting the repo.
    """
    if IS_WINDOWS:
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
        storage = base / "JARVIS" / "webview"
    elif sys.platform == "darwin":
        storage = Path.home() / "Library" / "Application Support" / "JARVIS" / "webview"
    else:
        xdg = os.environ.get("XDG_DATA_HOME")
        base = Path(xdg) if xdg else (Path.home() / ".local" / "share")
        storage = base / "jarvis" / "webview"

    storage.mkdir(parents=True, exist_ok=True)
    return storage


def _newest_mtime(paths: List[Path]) -> float:
    newest = 0.0
    for target in paths:
        if not target.exists():
            continue
        if target.is_file():
            try:
                newest = max(newest, target.stat().st_mtime)
            except OSError:
                pass
        elif target.is_dir():
            for root, dirs, files in os.walk(target):
                dirs[:] = [d for d in dirs if d not in ("node_modules", ".git", "dist")]
                for fname in files:
                    fpath = Path(root) / fname
                    try:
                        newest = max(newest, fpath.stat().st_mtime)
                    except OSError:
                        pass
    return newest


def resolve_server_mode(requested_mode: str, repo_root: Path = REPO_ROOT) -> str:
    """
    Decides whether `server.ts` should run in 'production' (serves compiled dist/)
    or 'development' (mounts Vite middleware).

    In 'auto' mode:
      - Uses 'production' if dist/index.html exists and is newer than frontend
        sources (fastest launch, lowest RAM, zero HMR/esbuild child overhead).
      - Falls back to 'development' if dist/ is missing or older than src/.
    """
    req = (requested_mode or "auto").strip().lower()
    if req in ("prod", "production"):
        return "production"
    if req in ("dev", "development"):
        return "development"

    dist_index = repo_root / "dist" / "index.html"
    if not dist_index.is_file():
        return "development"

    try:
        dist_mtime = dist_index.stat().st_mtime
    except OSError:
        return "development"

    source_mtime = _newest_mtime(
        [
            repo_root / "src",
            repo_root / "index.html",
            repo_root / "vite.config.ts",
            repo_root / "package.json",
        ]
    )
    return "production" if dist_mtime >= source_mtime else "development"


def resolve_server_command(repo_root: Path = REPO_ROOT) -> List[str]:
    """
    Builds the direct command to run `server.ts` without wrapping in `cmd.exe`
    or `npm.cmd` when possible. Running `node node_modules/tsx/dist/cli.mjs server.ts`
    directly avoids Windows batch wrapper orphan issues and speeds up boot.
    """
    server_entry = repo_root / "server.ts"
    if not server_entry.is_file():
        raise FileNotFoundError(f"Could not find server entrypoint: {server_entry}")

    node_bin = shutil.which("node")
    tsx_cli = repo_root / "node_modules" / "tsx" / "dist" / "cli.mjs"

    if node_bin and tsx_cli.is_file():
        return [node_bin, str(tsx_cli), str(server_entry)]

    local_tsx_bin = repo_root / "node_modules" / ".bin" / ("tsx.cmd" if IS_WINDOWS else "tsx")
    if local_tsx_bin.is_file():
        return [str(local_tsx_bin), str(server_entry)]

    npm_bin = shutil.which("npm.cmd" if IS_WINDOWS else "npm") or shutil.which("npm")
    if npm_bin:
        if not (repo_root / "node_modules").is_dir():
            raise RuntimeError(
                "Node dependencies are not installed yet (`node_modules/` is missing). "
                "Run `npm install` once in the project folder and try again."
            )
        return [npm_bin, "run", "dev"]

    raise RuntimeError(
        "Node.js was not found on PATH. Install Node.js v20+ (https://nodejs.org) "
        "and run `npm install` in the project folder."
    )


def probe_jarvis_health(host: str, port: int, timeout: float = 0.8) -> Tuple[bool, bool]:
    """
    Probes `http://<host>:<port>/api/jarvis/health`.
    Returns `(is_http_200, is_jarvis_server)`.
    """
    url = f"http://{host}:{port}/api/jarvis/health"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                return False, False
            attr_header = resp.headers.get("X-Creator-Attribution", "")
            body = resp.read().decode("utf-8", errors="replace")
            data = json.loads(body)
            is_jarvis = (
                "J.A.R.V.I.S" in attr_header
                or (isinstance(data, dict) and "activeProvider" in data and "reachable" in data)
            )
            return True, is_jarvis
    except Exception:
        return False, False


def is_port_in_use(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.35)
        return sock.connect_ex((host, port)) == 0


def find_free_port(host: str = DEFAULT_HOST) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return int(sock.getsockname()[1])


def probe_ollama_status(ollama_host: str = DEFAULT_OLLAMA_HOST, timeout: float = 0.8) -> Tuple[bool, int]:
    """Quick non-blocking check to print Ollama availability on startup."""
    url = f"{ollama_host.rstrip('/')}/api/tags"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8", errors="replace"))
            models = payload.get("models", []) if isinstance(payload, dict) else []
            return True, len(models)
    except Exception:
        return False, 0


# ---------------------------------------------------------------------------
# Windows Job Object helper (kernel-enforced child-tree teardown on exit)
# ---------------------------------------------------------------------------

def _create_kill_on_close_job() -> Optional[int]:
    """
    Creates a Windows Job Object configured with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.
    Any child process assigned to this job—and all of its descendants—is
    automatically terminated by Windows when the launcher exits or closes the handle.
    """
    if not IS_WINDOWS:
        return None

    try:
        kernel32 = ctypes.windll.kernel32
        kernel32.CreateJobObjectW.restype = ctypes.c_void_p
        kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p]
        kernel32.SetInformationJobObject.restype = ctypes.c_int
        kernel32.SetInformationJobObject.argtypes = [
            ctypes.c_void_p,
            ctypes.c_int,
            ctypes.c_void_p,
            ctypes.c_uint32,
        ]
        kernel32.AssignProcessToJobObject.restype = ctypes.c_int
        kernel32.AssignProcessToJobObject.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        kernel32.CloseHandle.restype = ctypes.c_int
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]

        class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("PerProcessUserTimeLimit", ctypes.c_int64),
                ("PerJobUserTimeLimit", ctypes.c_int64),
                ("LimitFlags", ctypes.c_uint32),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t),
                ("ActiveProcessLimit", ctypes.c_uint32),
                ("Affinity", ctypes.c_size_t),
                ("PriorityClass", ctypes.c_uint32),
                ("SchedulingClass", ctypes.c_uint32),
            ]

        class IO_COUNTERS(ctypes.Structure):
            _fields_ = [
                ("ReadOperationCount", ctypes.c_uint64),
                ("WriteOperationCount", ctypes.c_uint64),
                ("OtherOperationCount", ctypes.c_uint64),
                ("ReadTransferCount", ctypes.c_uint64),
                ("WriteTransferCount", ctypes.c_uint64),
                ("OtherTransferCount", ctypes.c_uint64),
            ]

        class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
                ("IoInfo", IO_COUNTERS),
                ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t),
            ]

        job = kernel32.CreateJobObjectW(None, None)
        if not job:
            return None

        info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
        info.BasicLimitInformation.LimitFlags = 0x00002000
        # JobObjectExtendedLimitInformation = 9
        ok = kernel32.SetInformationJobObject(
            job,
            9,
            ctypes.byref(info),
            ctypes.sizeof(info),
        )
        if not ok:
            kernel32.CloseHandle(job)
            return None

        return int(job)
    except Exception:
        return None


def _assign_process_to_job(job_handle: Optional[int], proc: subprocess.Popen) -> None:
    if not IS_WINDOWS or not job_handle:
        return
    try:
        kernel32 = ctypes.windll.kernel32
        proc_handle = getattr(proc, "_handle", None)
        if proc_handle:
            kernel32.AssignProcessToJobObject(ctypes.c_void_p(job_handle), ctypes.c_void_p(int(proc_handle)))
    except Exception:
        pass


def _close_job_handle(job_handle: Optional[int]) -> None:
    if not IS_WINDOWS or not job_handle:
        return
    try:
        ctypes.windll.kernel32.CloseHandle(ctypes.c_void_p(job_handle))
    except Exception:
        pass


class ServerProcessManager:
    """
    Manages the lifecycle of the local J.A.R.V.I.S Node/Express server subprocess,
    draining logs without pipe deadlocks and tearing down the entire process tree
    cleanly on Windows and POSIX.
    """

    def __init__(
        self,
        cmd: List[str],
        cwd: Path,
        env: Dict[str, str],
        verbose: bool = False,
    ) -> None:
        self.cmd = cmd
        self.cwd = cwd
        self.env = env
        self.verbose = verbose
        self.process: Optional[subprocess.Popen] = None
        self._job_handle: Optional[int] = None
        self._log_tail: Deque[str] = collections.deque(maxlen=200)
        self._lock = threading.Lock()
        self._stopped = False

    def start(self) -> None:
        popen_kwargs: Dict[str, object] = {
            "cwd": str(self.cwd),
            "env": self.env,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.STDOUT,
            "stdin": subprocess.DEVNULL,
            "text": True,
            "encoding": "utf-8",
            "errors": "replace",
            "bufsize": 1,
        }

        if IS_WINDOWS:
            creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(
                subprocess, "CREATE_NO_WINDOW", 0
            )
            popen_kwargs["creationflags"] = creationflags
        else:
            popen_kwargs["start_new_session"] = True

        self._job_handle = _create_kill_on_close_job()
        self.process = subprocess.Popen(self.cmd, **popen_kwargs)  # type: ignore[arg-type]
        _assign_process_to_job(self._job_handle, self.process)

        reader = threading.Thread(
            target=self._drain_output,
            name="jarvis-server-log-drain",
            daemon=True,
        )
        reader.start()

    def _drain_output(self) -> None:
        proc = self.process
        if proc is None or proc.stdout is None:
            return
        try:
            for line in proc.stdout:
                clean = line.rstrip("\r\n")
                self._log_tail.append(clean)
                if self.verbose and clean:
                    print(f"[server] {clean}", flush=True)
        except Exception:
            pass
        finally:
            try:
                proc.stdout.close()
            except Exception:
                pass

    def recent_logs(self, max_lines: int = 30) -> str:
        return "\n".join(list(self._log_tail)[-max_lines:])

    def wait_for_ready(
        self,
        host: str,
        port: int,
        timeout_sec: float = DEFAULT_STARTUP_TIMEOUT_SEC,
        poll_interval_sec: float = 0.25,
    ) -> None:
        deadline = time.monotonic() + timeout_sec
        while time.monotonic() < deadline:
            if self.process is not None:
                exit_code = self.process.poll()
                if exit_code is not None:
                    logs = self.recent_logs()
                    raise RuntimeError(
                        f"J.A.R.V.I.S server exited unexpectedly (code {exit_code}) before becoming ready.\n"
                        f"{logs or '(no server output captured)'}"
                    )

            ok, is_jarvis = probe_jarvis_health(host, port, timeout=0.8)
            if ok and is_jarvis:
                return

            time.sleep(poll_interval_sec)

        logs = self.recent_logs()
        raise TimeoutError(
            f"Timed out after {timeout_sec:.0f}s waiting for J.A.R.V.I.S server at http://{host}:{port}.\n"
            f"Recent server output:\n{logs or '(no server output captured)'}"
        )

    def stop(self) -> None:
        """Idempotently terminates the server and all descendant processes."""
        with self._lock:
            if self._stopped:
                return
            self._stopped = True
            proc = self.process
            job = self._job_handle
            self._job_handle = None

        if proc is not None and proc.poll() is None:
            pid = proc.pid
            if IS_WINDOWS:
                # Terminate the full Windows process tree (node -> tsx -> esbuild / vite)
                try:
                    subprocess.run(
                        ["taskkill", "/PID", str(pid), "/T", "/F"],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        timeout=8,
                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                    )
                except Exception:
                    try:
                        proc.terminate()
                    except Exception:
                        pass
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    try:
                        proc.kill()
                        proc.wait(timeout=3)
                    except Exception:
                        pass
            else:
                try:
                    pgid = os.getpgid(pid)
                    os.killpg(pgid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                except Exception:
                    try:
                        proc.terminate()
                    except Exception:
                        pass

                try:
                    proc.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(os.getpgid(pid), signal.SIGKILL)
                    except Exception:
                        try:
                            proc.kill()
                        except Exception:
                            pass
                    try:
                        proc.wait(timeout=3)
                    except Exception:
                        pass

        # Closing the Windows Job Object handle guarantees any straggler descendants die immediately
        _close_job_handle(job)


def ensure_production_build(repo_root: Path, env: Dict[str, str]) -> None:
    """Runs `npm run build` if `--prod` was explicitly requested and dist/index.html is missing."""
    dist_index = repo_root / "dist" / "index.html"
    if dist_index.is_file():
        return

    npm_bin = shutil.which("npm.cmd" if IS_WINDOWS else "npm") or shutil.which("npm")
    if not npm_bin:
        raise RuntimeError("Cannot build `dist/` because `npm` was not found on PATH.")

    print("[JARVIS] `dist/index.html` not found — running `npm run build`...", flush=True)
    result = subprocess.run([npm_bin, "run", "build"], cwd=str(repo_root), env=env)
    if result.returncode != 0:
        raise RuntimeError(f"`npm run build` failed with exit code {result.returncode}.")


def build_child_env(repo_root: Path, port: int, server_mode: str) -> Dict[str, str]:
    """Builds the environment dict for `server.ts`, merging optional `.env` entries."""
    env = os.environ.copy()
    for key, val in parse_dotenv(repo_root / ".env").items():
        env.setdefault(key, val)
    env["PORT"] = str(port)
    env["NODE_ENV"] = server_mode
    return env


def _build_save_file_types(filename: str) -> Tuple[str, ...]:
    """Returns native file-dialog filter strings matching the exported file extension."""
    ext = Path(filename).suffix.lower()
    mapping = {
        ".docx": ("Word Document (*.docx)", "All files (*.*)"),
        ".xlsx": ("Excel Workbook (*.xlsx)", "All files (*.*)"),
        ".pptx": ("PowerPoint Presentation (*.pptx)", "All files (*.*)"),
        ".md": ("Markdown Document (*.md)", "All files (*.*)"),
        ".json": ("JSON File (*.json)", "All files (*.*)"),
        ".pdf": ("PDF Document (*.pdf)", "All files (*.*)"),
    }
    return mapping.get(ext, ("All files (*.*)",))


def _resolve_save_dialog_type(webview_mod: object) -> object:
    """Resolves SAVE_DIALOG constant cleanly across pywebview 4.x, 5.x, and 6.x."""
    file_dialog_enum = getattr(webview_mod, "FileDialog", None)
    if file_dialog_enum is not None and hasattr(file_dialog_enum, "SAVE"):
        return getattr(file_dialog_enum, "SAVE")
    return getattr(webview_mod, "SAVE_DIALOG", 30)


def _normalize_dialog_selection(selection: object) -> Optional[str]:
    """Normalizes pywebview create_file_dialog return value (str | tuple | list | None)."""
    if not selection:
        return None
    if isinstance(selection, (list, tuple)):
        first = selection[0] if selection else None
        return str(first).strip() if first else None
    text = str(selection).strip()
    return text or None


class DesktopApi:
    """
    pywebview JS-to-Python bridge exposed as `window.pywebview.api`.
    Provides reliable native file saving when WebView2 drops `blob:` downloads.
    """

    def __init__(self) -> None:
        self._window: Optional[object] = None
        self._webview: Optional[object] = None

    def attach(self, window: object, webview_mod: object) -> None:
        self._window = window
        self._webview = webview_mod

    def save_file(self, filename: str, base64_data: str) -> Dict[str, object]:
        """Opens a native Save dialog, decodes base64_data, and writes bytes to disk."""
        safe_name = Path(str(filename or "jarvis_export.bin")).name or "jarvis_export.bin"
        webview_mod = self._webview
        window = self._window

        if window is None and webview_mod is not None:
            windows = getattr(webview_mod, "windows", None)
            if windows:
                window = windows[0]

        if window is None or webview_mod is None or not hasattr(window, "create_file_dialog"):
            return {"ok": False, "error": "Desktop save dialog is unavailable."}

        try:
            payload = str(base64_data or "").strip()
            if payload.startswith("data:") and "," in payload:
                payload = payload.split(",", 1)[1]
            raw_bytes = base64.b64decode(payload, validate=True)
        except Exception as exc:
            return {"ok": False, "error": f"Invalid file payload: {exc}"}

        dialog_type = _resolve_save_dialog_type(webview_mod)
        downloads_dir = Path.home() / "Downloads"
        initial_dir = str(downloads_dir) if downloads_dir.is_dir() else str(Path.home())

        dialog_kwargs: Dict[str, object] = {
            "directory": initial_dir,
            "save_filename": safe_name,
            "file_types": _build_save_file_types(safe_name),
        }

        try:
            sig = inspect.signature(window.create_file_dialog)
            supported_kwargs = {k: v for k, v in dialog_kwargs.items() if k in sig.parameters}
        except (TypeError, ValueError):
            supported_kwargs = {"directory": initial_dir, "save_filename": safe_name}

        try:
            selection = window.create_file_dialog(dialog_type, **supported_kwargs)  # type: ignore[attr-defined]
        except TypeError:
            selection = window.create_file_dialog(dialog_type, save_filename=safe_name)  # type: ignore[attr-defined]
        except Exception as exc:
            return {"ok": False, "error": f"Could not open save dialog: {exc}"}

        saved_path_str = _normalize_dialog_selection(selection)
        if not saved_path_str:
            return {"ok": False, "cancelled": True}

        target = Path(saved_path_str)
        expected_suffix = Path(safe_name).suffix
        if expected_suffix and not target.suffix:
            target = target.with_suffix(expected_suffix)

        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw_bytes)
            return {"ok": True, "path": str(target)}
        except OSError as exc:
            return {"ok": False, "error": f"Failed to write file: {exc}"}


def launch_desktop_window(
    url: str,
    debug: bool = False,
    gui: Optional[str] = None,
) -> Tuple[object, object, Dict[str, object]]:
    """Opens the J.A.R.V.I.S TypeScript frontend in a native pywebview desktop window."""
    try:
        import webview  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "Missing Python dependency `pywebview`.\n"
            "Install it once with:\n"
            "    pip install pywebview\n"
        ) from exc

    if IS_WINDOWS:
        try:
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("cosmoknight.jarvis.desktop")
        except Exception:
            pass

    if hasattr(webview, "settings") and isinstance(webview.settings, dict):
        webview.settings["ALLOW_DOWNLOADS"] = True

    storage_dir = str(get_webview_storage_dir())
    icon_path = REPO_ROOT / "assets" / ("jarvis_circle.ico" if IS_WINDOWS else "jarvis_circle.png")

    desktop_api = DesktopApi()

    window_kwargs: Dict[str, object] = {
        "title": WINDOW_TITLE,
        "url": url,
        "js_api": desktop_api,
        "width": 1360,
        "height": 860,
        "min_size": (960, 640),
        "background_color": WINDOW_BG_HEX,
    }

    # Filter create_window kwargs for cross-version pywebview compatibility (4.x / 5.x / 6.x)
    cw_params = inspect.signature(webview.create_window).parameters
    filtered_window_kwargs = {k: v for k, v in window_kwargs.items() if k in cw_params}
    window = webview.create_window(**filtered_window_kwargs)
    desktop_api.attach(window, webview)

    start_kwargs: Dict[str, object] = {
        "debug": debug,
        "private_mode": False,
        "storage_path": storage_dir,
    }
    if gui:
        start_kwargs["gui"] = gui
    if icon_path.is_file() and (not IS_WINDOWS or icon_path.suffix.lower() == ".ico"):
        start_kwargs["icon"] = str(icon_path)

    start_params = inspect.signature(webview.start).parameters
    filtered_start_kwargs = {k: v for k, v in start_kwargs.items() if k in start_params}

    return window, webview, filtered_start_kwargs


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Launch the J.A.R.V.I.S TypeScript/React GUI in a native pywebview desktop window."
    )
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--dev",
        action="store_true",
        help="Force Vite dev middleware mode (live edits without running `npm run build`).",
    )
    mode_group.add_argument(
        "--prod",
        action="store_true",
        help="Force production dist/ mode (builds dist/ first if missing).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"Preferred local port for server.ts (default: {DEFAULT_PORT}).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_STARTUP_TIMEOUT_SEC,
        help=f"Seconds to wait for local server readiness (default: {int(DEFAULT_STARTUP_TIMEOUT_SEC)}).",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable WebView DevTools inside the desktop window.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Mirror server.ts stdout/stderr to the launcher console.",
    )
    parser.add_argument(
        "--gui",
        default=None,
        help="Optional pywebview backend override (e.g. edgechromium, gtk, qt, cocoa).",
    )
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    _enable_utf8_console()
    args = parse_args(argv)

    # Verify pywebview is installed before spawning Node so we fail fast with a clear pip command
    try:
        import webview as _webview_check  # noqa: F401
    except ImportError:
        print(
            "[JARVIS] Missing Python package `pywebview`.\n"
            "Install it with:\n"
            "    pip install pywebview\n",
            file=sys.stderr,
        )
        return 1

    requested_mode = "development" if args.dev else "production" if args.prod else "auto"
    server_mode = resolve_server_mode(requested_mode, REPO_ROOT)

    ollama_ok, ollama_count = probe_ollama_status()
    if ollama_ok:
        print(f"[JARVIS] Local Ollama detected ({ollama_count} model(s) installed).", flush=True)
    else:
        print("[JARVIS] Local Ollama not detected on 127.0.0.1:11434 (you can start `ollama serve` anytime).", flush=True)

    port = args.port
    manager: Optional[ServerProcessManager] = None

    # 1. Check whether the preferred port is already serving J.A.R.V.I.S or occupied by another app
    already_up, is_jarvis = probe_jarvis_health(DEFAULT_HOST, port, timeout=0.6)
    if already_up and is_jarvis:
        print(f"[JARVIS] Attaching to existing J.A.R.V.I.S server at http://{DEFAULT_HOST}:{port}", flush=True)
    else:
        if is_port_in_use(DEFAULT_HOST, port):
            fallback_port = find_free_port(DEFAULT_HOST)
            print(
                f"[JARVIS] Port {port} is in use by another process — launching J.A.R.V.I.S on port {fallback_port}.",
                flush=True,
            )
            port = fallback_port

        child_env = build_child_env(REPO_ROOT, port=port, server_mode=server_mode)
        if args.prod:
            ensure_production_build(REPO_ROOT, child_env)

        cmd = resolve_server_command(REPO_ROOT)
        manager = ServerProcessManager(cmd=cmd, cwd=REPO_ROOT, env=child_env, verbose=args.verbose)

        # Register fail-safe teardown hooks BEFORE spawning child process
        atexit.register(manager.stop)

        def _handle_signal(_signum: int, _frame: object) -> None:
            manager.stop()
            sys.exit(0)

        for sig_name in ("SIGINT", "SIGTERM"):
            sig = getattr(signal, sig_name, None)
            if sig is not None:
                try:
                    signal.signal(sig, _handle_signal)
                except Exception:
                    pass

        mode_label = "production (dist/)" if server_mode == "production" else "development (Vite)"
        print(f"[JARVIS] Starting local server in {mode_label} mode on http://{DEFAULT_HOST}:{port} ...", flush=True)
        manager.start()

        try:
            manager.wait_for_ready(DEFAULT_HOST, port, timeout_sec=args.timeout)
        except Exception as exc:
            print(f"[JARVIS] Startup failed: {exc}", file=sys.stderr, flush=True)
            manager.stop()
            return 1

        print("[JARVIS] Server ready — opening desktop window.", flush=True)

    app_url = f"http://{DEFAULT_HOST}:{port}"

    try:
        window, webview_mod, start_kwargs = launch_desktop_window(
            url=app_url,
            debug=args.debug,
            gui=args.gui,
        )

        if manager is not None and hasattr(window, "events") and hasattr(window.events, "closed"):
            window.events.closed += lambda *_args: manager.stop()

        webview_mod.start(**start_kwargs)  # type: ignore[attr-defined]
    except KeyboardInterrupt:
        pass
    finally:
        if manager is not None:
            print("[JARVIS] Shutting down local server...", flush=True)
            manager.stop()

    return 0


if __name__ == "__main__":
    sys.exit(main())
