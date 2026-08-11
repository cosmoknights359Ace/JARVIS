# Making JARVIS a desktop app

You have two options. Both end with a clickable icon — no terminal.

## Option A — Real .exe (recommended)

1. Put these 3 files in the same folder:
   - `jarvis_gui.py`
   - `jarvis_icon.ico`
   - `build_exe.bat`
2. Double-click `build_exe.bat`. It installs PyInstaller and builds the app.
3. Your app appears at `dist\JARVIS.exe`.
4. Right-click `JARVIS.exe` → **Send to → Desktop (create shortcut)**.

Done. Double-click the desktop icon anytime — it opens with your custom
icon, no console window, no typing `python jarvis_gui.py`.

Note: the built `.exe` is a full standalone copy — if you edit
`jarvis_gui.py` later, rerun `build_exe.bat` to rebuild it.

## Option B — Shortcut only (no build step)

Faster, but still needs Python installed on the machine you run it on.

1. Put these files in the same folder:
   - `jarvis_gui.pyw` (same code, but this extension skips the console window)
   - `jarvis_icon.ico`
   - `create_shortcut.ps1`
2. Right-click `create_shortcut.ps1` → **Run with PowerShell**.
3. A `JARVIS` shortcut appears on your Desktop automatically.

If it can't find `pythonw.exe` automatically, open the script and set
the path manually near the top (it tells you exactly what to edit).

## Either way

Both `memory.json` and `jarvis.log` get created next to wherever the
app actually runs from — so keep the exe/shortcut's target folder
somewhere you won't accidentally delete.
