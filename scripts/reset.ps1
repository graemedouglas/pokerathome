#
# Full reset: kill dev processes, remove database files, optionally restart.
#
# Usage:
#   .\scripts\reset.ps1          # kill + clean
#   .\scripts\reset.ps1 -Start   # kill + clean + restart servers + create game
#

param(
  [switch]$Start
)

$ErrorActionPreference = "Continue"
$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$DbDir = Join-Path $RootDir "server"

# ─── Kill dev processes ──────────────────────────────────────────────────────────

Write-Host "=== Stopping dev processes ==="
& (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "kill-dev.ps1")
Start-Sleep -Seconds 1

# ─── Remove database files ──────────────────────────────────────────────────────

Write-Host ""
Write-Host "=== Cleaning database ==="

$removed = 0
$dbFiles = @("pokerathome.db", "pokerathome.db-wal", "pokerathome.db-shm")
foreach ($f in $dbFiles) {
  $path = Join-Path $DbDir $f
  if (Test-Path $path) {
    Remove-Item $path -Force
    Write-Host "Removed $f"
    $removed++
  }
}

if ($removed -eq 0) {
  Write-Host "No database files to remove"
}

# ─── Optionally restart ─────────────────────────────────────────────────────────

if ($Start) {
  Write-Host ""
  Write-Host "=== Starting servers ==="

  Set-Location $RootDir

  # Start server in background
  $serverJob = Start-Job -ScriptBlock {
    Set-Location $using:RootDir
    pnpm dev 2>&1
  }
  Write-Host "Server starting (job $($serverJob.Id))..."

  # Start UI in background
  $uiJob = Start-Job -ScriptBlock {
    Set-Location $using:RootDir
    pnpm dev:ui 2>&1
  }
  Write-Host "UI starting (job $($uiJob.Id))..."

  # Start admin in background
  $adminJob = Start-Job -ScriptBlock {
    Set-Location $using:RootDir
    pnpm dev:admin 2>&1
  }
  Write-Host "Admin starting (job $($adminJob.Id))..."

  # Wait for server to be ready
  Write-Host "Waiting for server health check..."
  $ready = $false
  for ($i = 1; $i -le 15; $i++) {
    try {
      $res = Invoke-RestMethod -Uri "http://localhost:3000/health" -TimeoutSec 2 -ErrorAction SilentlyContinue
      if ($res.status -eq "ok") {
        Write-Host "Server is healthy"
        $ready = $true
        break
      }
    } catch {}
    Start-Sleep -Seconds 1
  }

  if (-not $ready) {
    Write-Host "Warning: server did not become healthy in time"
  }

  # Create a game
  Write-Host ""
  Write-Host "=== Creating game ==="
  try {
    $body = @{
      name = "Test Table"
      smallBlind = 5
      bigBlind = 10
      maxPlayers = 6
      startingStack = 1000
    } | ConvertTo-Json

    $game = Invoke-RestMethod -Uri "http://localhost:3000/api/games" `
      -Method Post -ContentType "application/json" -Body $body
    Write-Host "Game created: $($game.name) ($($game.id))"
  } catch {
    Write-Host "Warning: failed to create game"
  }

  Write-Host ""
  Write-Host "=== Ready ==="
  Write-Host "  Server:  http://localhost:3000"
  Write-Host "  UI:      http://localhost:5173"
  Write-Host "  Admin:   http://localhost:3001"
  Write-Host "  API:     http://localhost:3000/api/games"
  Write-Host ""
  Write-Host "Press Ctrl+C to stop. Then run: .\scripts\kill-dev.ps1"

  # Wait for jobs
  try {
    Wait-Job -Job $serverJob, $uiJob, $adminJob -Any | Out-Null
  } finally {
    Stop-Job -Job $serverJob, $uiJob, $adminJob -ErrorAction SilentlyContinue
    Remove-Job -Job $serverJob, $uiJob, $adminJob -Force -ErrorAction SilentlyContinue
  }
} else {
  Write-Host ""
  Write-Host "Reset complete. Run with -Start to also restart servers."
}
