<#
 .SYNOPSIS
   Launch any JARVIS script using the project's win-venv, so you never
   hit "ModuleNotFoundError: No module named 'ollama'". Automatically
   starts the Ollama server (if installed) so the model can respond.

 .USAGE
   .\run_venv.ps1 jarvis.py            # terminal edition
   .\run_venv.ps1 jarvis_gui.py        # GUI edition (also starts Ollama)
   .\run_venv.ps1 -Command "import ollama; print('ok')"

   Pass extra args after the script name, e.g.:
   .\run_venv.ps1 jarvis.py --something

   Switches:
   -NoOllama   Do NOT attempt to start the Ollama server.
#>
param(
    [Parameter(Position = 0)]
    [string]$Script,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args,
    [string]$Command,
    [switch]$NoOllama
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPy = Join-Path $root "win-venv\Scripts\python.exe"

if (-not (Test-Path $venvPy)) {
    Write-Error "win-venv not found at $venvPy. Create it with:`n  python -m venv win-venv`n  win-venv\Scripts\pip install -r requirements.txt"
    exit 1
}

# --- Ensure Ollama server is running (so the model can reply) ---------------
# Only auto-start when launching the GUI/CLI chat (not for -Command probes).
$needsOllama = (-not $NoOllama) -and ($Script -or $Command)
if ($needsOllama) {
    $ollamaExe = (Get-Command ollama.exe -ErrorAction SilentlyContinue).Source
    $alreadyUp = $false
    if ($ollamaExe) {
        try {
            & $venvPy -c "import ollama; ollama.Client().list()" 2>$null
            $alreadyUp = $LASTEXITCODE -eq 0
        } catch { $alreadyUp = $false }
    }
    if (-not $alreadyUp) {
        if ($ollamaExe) {
            Write-Host "[run_venv] Starting Ollama server..." -ForegroundColor Cyan
            Start-Process -FilePath $ollamaExe -ArgumentList "serve" -WindowStyle Hidden
            # Wait up to ~20s for the server to accept connections.
            for ($i = 0; $i -lt 20; $i++) {
                & $venvPy -c "import ollama; ollama.Client().list()" 2>$null
                if ($LASTEXITCODE -eq 0) { break }
                Start-Sleep -Seconds 1
            }
            Write-Host "[run_venv] Ollama ready." -ForegroundColor Green
        } else {
            Write-Warning "[run_venv] Ollama not installed; the app will show OFFLINE until you start it."
        }
    }
}

if ($Command) {
    # Run a one-off inline command and exit (does not hang the terminal).
    & $venvPy -c $Command @Args
} elseif ($Script) {
    & $venvPy (Join-Path $root $Script) @Args
} else {
    # No script given -> drop into an interactive venv shell
    & $venvPy
}
