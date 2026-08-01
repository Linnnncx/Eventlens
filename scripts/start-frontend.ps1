# Start EventLens frontend (Windows PowerShell)
$root = Split-Path -Parent $PSScriptRoot
Set-Location "$root\frontend"
if (-not (Test-Path node_modules)) { npm install --registry https://registry.npmmirror.com }
npm run dev -- --host 127.0.0.1 --port 5173
