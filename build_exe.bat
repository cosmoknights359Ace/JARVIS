@echo off
REM ============================================================
REM  Builds JARVIS into a standalone, double-clickable .exe
REM  with its own desktop icon. Run this once from this folder.
REM ============================================================

echo Installing PyInstaller (skips if already installed)...
pip install pyinstaller

echo.
echo Building JARVIS.exe ...
pyinstaller --noconfirm --onefile --windowed ^
    --name "JARVIS" ^
    --icon "jarvis_icon.ico" ^
    --add-data "jarvis_icon.ico;." ^
    jarvis_gui.py

echo.
echo ============================================================
echo Done! Your app is at:  dist\JARVIS.exe
echo Right-click it, choose "Send to > Desktop (create shortcut)"
echo and you're done — double-click that shortcut any time.
echo ============================================================
pause
