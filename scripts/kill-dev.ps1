#
# Kill running dev server (port 3000), admin dev server (port 3001), and UI dev server (port 5173).
#

function Stop-DevPort {
  param(
    [int]$Port,
    [string]$Name
  )

  $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
  if ($connections) {
    $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pid in $pids) {
      try {
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc) {
          Write-Host "Killing $Name (port $Port, pid $pid, $($proc.ProcessName))..."
          Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
      } catch {
        # Process may have already exited
      }
    }
  } else {
    Write-Host "No $Name process found on port $Port"
  }
}

Stop-DevPort -Port 3000 -Name "game server"
Stop-DevPort -Port 3001 -Name "admin dev server"
Stop-DevPort -Port 5173 -Name "UI dev server"

Write-Host "Done."
