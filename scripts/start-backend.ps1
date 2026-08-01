# Start EventLens backend (Windows PowerShell)
$root = Split-Path -Parent $PSScriptRoot
Set-Location "$root\backend"
$env:PYTHONPATH = "$root\backend"
if (-not (Test-Path .venv)) { python -m venv .venv }
.\.venv\Scripts\python -m pip install -r requirements.txt
New-Item -ItemType Directory -Force -Path data | Out-Null
.\.venv\Scripts\uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
