# ============================================================
#  Creates a JARVIS desktop shortcut WITHOUT building an .exe.
#  Double-click this .lnk anytime and Jarvis launches silently
#  in the background (no terminal window).
#
#  Usage:
#    1. Put jarvis_gui.pyw and jarvis_icon.ico in the SAME folder.
#    2. Right-click this file -> "Run with PowerShell"
#       (or run:  powershell -ExecutionPolicy Bypass -File create_shortcut.ps1)
# ============================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PywPath   = Join-Path $ScriptDir "jarvis_gui.pyw"
$IconPath  = Join-Path $ScriptDir "jarvis_icon.ico"
$Desktop   = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "JARVIS.lnk"

# Find pythonw.exe (the no-console version of Python) automatically
$PythonwPath = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
if (-not $PythonwPath) {
    $PythonPath = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
    if ($PythonPath) {
        $PythonwPath = $PythonPath -replace "python\.exe$", "pythonw.exe"
    }
}

if (-not $PythonwPath -or -not (Test-Path $PythonwPath)) {
    Write-Host "Couldn't find pythonw.exe automatically." -ForegroundColor Yellow
    Write-Host "Edit this script and set `$PythonwPath manually, e.g.:" -ForegroundColor Yellow
    Write-Host '  $PythonwPath = "C:\Users\YOU\AppData\Local\Programs\Python\Python312\pythonw.exe"'
    exit 1
}

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $PythonwPath
$Shortcut.Arguments = "`"$PywPath`""
$Shortcut.WorkingDirectory = $ScriptDir
$Shortcut.IconLocation = $IconPath
$Shortcut.Description = "J.A.R.V.I.S Assistant"
$Shortcut.Save()

Write-Host "Done! 'JARVIS' shortcut created on your Desktop." -ForegroundColor Green
