#!/usr/bin/env bash
#
# Kill running dev server (port 3000) and UI dev server (port 5173).
#

set -euo pipefail

kill_port() {
  local port=$1
  local name=$2
  local pids

  # Try lsof first (macOS + most Linux)
  if command -v lsof &>/dev/null; then
    pids=$(lsof -ti :"$port" 2>/dev/null || true)
  # Fall back to fuser (Linux)
  elif command -v fuser &>/dev/null; then
    pids=$(fuser "$port/tcp" 2>/dev/null | tr -s ' ' '\n' || true)
  else
    echo "Warning: neither lsof nor fuser found — cannot detect processes on port $port"
    return
  fi

  if [ -n "$pids" ]; then
    echo "Killing $name (port $port, pids: $(echo $pids | tr '\n' ' '))..."
    echo "$pids" | xargs kill 2>/dev/null || true
    sleep 1
    # Force kill any remaining
    echo "$pids" | xargs kill -9 2>/dev/null || true
  else
    echo "No $name process found on port $port"
  fi
}

kill_port 3000 "game server"
kill_port 5173 "UI dev server"

echo "Done."
