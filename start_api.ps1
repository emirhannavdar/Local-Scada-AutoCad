param([switch]$EnableCommands)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw 'Projenin .venv Python ortamı bulunamadı.' }
if ($EnableCommands) { $env:SCADA_ENABLE_COMMANDS = '1' }
& $python -m uvicorn api.api:app --host 0.0.0.0 --port 8000
exit $LASTEXITCODE
