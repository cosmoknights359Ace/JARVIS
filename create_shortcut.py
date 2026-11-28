#!/usr/bin/env python3
"""
SPDX-License-Identifier: MIT
Copyright (c) 2026 cosmoknight — J.A.R.V.I.S Silent Windows Desktop Shortcut Creator

Generates:
  1. `Launch_JARVIS.vbs` in the project root, which runs `jarvis_gui.py` silently
     using `pythonw.exe` (or `python.exe` with hidden window style `0`) so zero
     black console window flashes on launch.
  2. A `JARVIS.lnk` shortcut on the current user's Windows Desktop pointing to
     `Launch_JARVIS.vbs` with its icon set to `assets/jarvis_circle.ico`.

Usage:
    python create_shortcut.py
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent
VBS_FILENAME = "Launch_JARVIS.vbs"
SHORTCUT_NAME = "JARVIS.lnk"
ICO_REL_PATH = Path("assets") / "jarvis_circle.ico"
PNG_REL_PATH = Path("assets") / "jarvis_circle.png"


def _escape_vbs_string(value: str) -> str:
    """Escapes double quotes and strips newlines for safe VBScript string literals."""
    clean = str(value).replace("\r", "").replace("\n", "")
    return clean.replace('"', '""')


def resolve_silent_python_executable(repo_root: Path = REPO_ROOT) -> str:
    """
    Resolves the best Python executable for silent desktop launch on Windows:
      1. Project-local virtual environment `pythonw.exe` (if present)
      2. Sibling `pythonw.exe` next to the current `sys.executable`
      3. `pythonw.exe` on PATH
      4. Current `sys.executable` (still launched with VBScript window style 0 / hidden)
    """
    venv_candidates = [
        repo_root / "jarvis-env" / "Scripts" / "pythonw.exe",
        repo_root / "win-venv" / "Scripts" / "pythonw.exe",
        repo_root / ".venv" / "Scripts" / "pythonw.exe",
        repo_root / "venv" / "Scripts" / "pythonw.exe",
    ]
    for candidate in venv_candidates:
        if candidate.is_file():
            return str(candidate)

    if sys.platform == "win32":
        current_py = Path(sys.executable)
        sibling_pythonw = current_py.with_name("pythonw.exe")
        if sibling_pythonw.is_file():
            return str(sibling_pythonw)

        found_pythonw = shutil.which("pythonw.exe") or shutil.which("pythonw")
        if found_pythonw:
            return found_pythonw

        return str(current_py)

    return "pythonw.exe"


def ensure_ico_asset(repo_root: Path = REPO_ROOT) -> Path:
    """
    Returns `assets/jarvis_circle.ico`. If it does not exist yet and Pillow is
    installed alongside `assets/jarvis_circle.png`, generates the `.ico` automatically.
    """
    ico_path = repo_root / ICO_REL_PATH
    if ico_path.is_file():
        return ico_path

    png_path = repo_root / PNG_REL_PATH
    if png_path.is_file():
        try:
            from PIL import Image  # type: ignore

            ico_path.parent.mkdir(parents=True, exist_ok=True)
            with Image.open(png_path) as img:
                rgba = img.convert("RGBA")
                rgba.save(
                    ico_path,
                    format="ICO",
                    sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
                )
        except Exception:
            pass

    return ico_path


def build_vbs_launcher_content(
    repo_root: Path = REPO_ROOT,
    python_exe: Optional[str] = None,
) -> str:
    """Builds the VBScript launcher that starts `jarvis_gui.py` with window style 0 (hidden)."""
    resolved_dir = str(repo_root.resolve())
    script_path = str((repo_root.resolve() / "jarvis_gui.py"))
    resolved_py = python_exe or resolve_silent_python_executable(repo_root)

    vbs_dir = _escape_vbs_string(resolved_dir)
    vbs_py = _escape_vbs_string(resolved_py)
    vbs_script = _escape_vbs_string(script_path)

    return (
        "' J.A.R.V.I.S Silent Desktop Launcher (c) 2026 cosmoknight\r\n"
        "' Launches jarvis_gui.py with window style 0 (hidden) so no console window flashes.\r\n"
        "Option Explicit\r\n"
        "Dim WshShell, Fso, ProjectDir, PythonExe, GuiScript, Cmd\r\n"
        'Set WshShell = CreateObject("WScript.Shell")\r\n'
        'Set Fso = CreateObject("Scripting.FileSystemObject")\r\n'
        f'ProjectDir = "{vbs_dir}"\r\n'
        f'PythonExe = "{vbs_py}"\r\n'
        f'GuiScript = "{vbs_script}"\r\n'
        "If Not Fso.FileExists(PythonExe) Then\r\n"
        '    PythonExe = "pythonw.exe"\r\n'
        "End If\r\n"
        "WshShell.CurrentDirectory = ProjectDir\r\n"
        'Cmd = """" & PythonExe & """ """ & GuiScript & """"\r\n'
        "WshShell.Run Cmd, 0, False\r\n"
    )


def write_vbs_launcher(
    repo_root: Path = REPO_ROOT,
    python_exe: Optional[str] = None,
) -> Path:
    """Writes `Launch_JARVIS.vbs` into `repo_root` and returns its path."""
    vbs_path = repo_root / VBS_FILENAME
    content = build_vbs_launcher_content(repo_root=repo_root, python_exe=python_exe)
    vbs_path.write_text(content, encoding="utf-8")
    return vbs_path


def build_shortcut_creator_vbs(
    vbs_launcher_path: Path,
    working_dir: Path,
    icon_path: Optional[Path] = None,
    shortcut_name: str = SHORTCUT_NAME,
    desktop_dir: Optional[Path] = None,
) -> str:
    """
    Builds a self-contained VBScript that creates `JARVIS.lnk` on the user's
    Windows Desktop (automatically honoring OneDrive-redirected Desktop paths).
    Applies `IconLocation` only when the `.ico` file is present.
    """
    target_esc = _escape_vbs_string(str(vbs_launcher_path.resolve()))
    workdir_esc = _escape_vbs_string(str(working_dir.resolve()))
    name_esc = _escape_vbs_string(shortcut_name)

    if desktop_dir is not None:
        desktop_expr = f'"{_escape_vbs_string(str(desktop_dir.resolve()))}"'
    else:
        desktop_expr = 'WshShell.SpecialFolders("Desktop")'

    icon_block = ""
    if icon_path is not None:
        icon_esc = _escape_vbs_string(str(icon_path.resolve()))
        icon_block = (
            f'IconPath = "{icon_esc}"\r\n'
            "If Fso.FileExists(IconPath) Then\r\n"
            '    Shortcut.IconLocation = IconPath & ",0"\r\n'
            "End If\r\n"
        )

    return (
        "Option Explicit\r\n"
        "Dim WshShell, Fso, DesktopDir, ShortcutPath, Shortcut, IconPath\r\n"
        'Set WshShell = CreateObject("WScript.Shell")\r\n'
        'Set Fso = CreateObject("Scripting.FileSystemObject")\r\n'
        f"DesktopDir = {desktop_expr}\r\n"
        f'ShortcutPath = DesktopDir & "\\{name_esc}"\r\n'
        "Set Shortcut = WshShell.CreateShortcut(ShortcutPath)\r\n"
        f'Shortcut.TargetPath = "{target_esc}"\r\n'
        f'Shortcut.WorkingDirectory = "{workdir_esc}"\r\n'
        f"{icon_block}"
        'Shortcut.Description = "Launch J.A.R.V.I.S Desktop Assistant"\r\n'
        "Shortcut.WindowStyle = 7\r\n"
        "Shortcut.Save\r\n"
    )


def create_windows_desktop_shortcut(
    vbs_launcher_path: Path,
    repo_root: Path = REPO_ROOT,
    icon_path: Optional[Path] = None,
    desktop_dir: Optional[Path] = None,
) -> Path:
    """Creates `JARVIS.lnk` on the user's Windows Desktop via `wscript.exe`."""
    if sys.platform != "win32":
        raise RuntimeError(
            "Windows Desktop (.lnk) shortcut creation requires Windows (`wscript.exe`)."
        )

    resolved_icon = icon_path or ensure_ico_asset(repo_root)
    builder_script = build_shortcut_creator_vbs(
        vbs_launcher_path=vbs_launcher_path,
        working_dir=repo_root,
        icon_path=resolved_icon,
        shortcut_name=SHORTCUT_NAME,
        desktop_dir=desktop_dir,
    )

    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".vbs",
        prefix="jarvis_mkshortcut_",
        encoding="utf-8",
        delete=False,
    ) as tmp:
        tmp.write(builder_script)
        tmp_path = Path(tmp.name)

    try:
        wscript = shutil.which("wscript.exe") or "wscript.exe"
        subprocess.run(
            [wscript, "//Nologo", str(tmp_path)],
            check=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass

    if desktop_dir is not None:
        return desktop_dir / SHORTCUT_NAME

    user_desktop = Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Desktop"
    return user_desktop / SHORTCUT_NAME


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create Launch_JARVIS.vbs and a silent Windows Desktop shortcut for J.A.R.V.I.S."
    )
    parser.add_argument(
        "--vbs-only",
        action="store_true",
        help="Only generate Launch_JARVIS.vbs without creating the Windows Desktop .lnk shortcut.",
    )
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)

    ico_path = ensure_ico_asset(REPO_ROOT)
    vbs_path = write_vbs_launcher(REPO_ROOT)
    print(f"[JARVIS] Created silent launcher: {vbs_path}")

    if args.vbs_only:
        return 0

    if sys.platform != "win32":
        print(
            "[JARVIS] Non-Windows OS detected: generated Launch_JARVIS.vbs. "
            "Run `python create_shortcut.py` on Windows to place JARVIS.lnk on your Desktop."
        )
        return 0

    try:
        shortcut_path = create_windows_desktop_shortcut(
            vbs_launcher_path=vbs_path,
            repo_root=REPO_ROOT,
            icon_path=ico_path,
        )
        print(f"[JARVIS] Created Desktop shortcut: {shortcut_path}")
        print(f"[JARVIS] Shortcut icon: {ico_path}")
        return 0
    except Exception as exc:
        print(f"[JARVIS] Failed to create Desktop shortcut: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
