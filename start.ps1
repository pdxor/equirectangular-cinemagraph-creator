$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
if (-not (Test-Path -LiteralPath 'data')) { New-Item -ItemType Directory -Path 'data' | Out-Null }
docker compose up --build -d
if ($LASTEXITCODE -ne 0) { throw 'Docker startup failed. Open Docker Desktop and check that its engine is running.' }
Write-Host 'Open http://localhost:4317'
