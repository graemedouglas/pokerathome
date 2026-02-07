#!/usr/bin/env bash
#
# Full reset: kill dev processes, remove database files, optionally restart.
#
# Usage:
#   ./scripts/reset.sh          # kill + clean
#   ./scripts/reset.sh --start  # kill + clean + restart servers + create game
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_DIR="$ROOT_DIR/server"

# ─── Kill dev processes ──────────────────────────────────────────────────────────

echo "=== Stopping dev processes ==="
bash "$SCRIPT_DIR/kill-dev.sh"
sleep 1

# ─── Remove database files ──────────────────────────────────────────────────────

echo ""
echo "=== Cleaning database ==="

removed=0
for f in "$DB_DIR"/pokerathome.db "$DB_DIR"/pokerathome.db-wal "$DB_DIR"/pokerathome.db-shm; do
  if [ -f "$f" ]; then
    rm -f "$f"
    echo "Removed $(basename "$f")"
    removed=$((removed + 1))
  fi
done

if [ "$removed" -eq 0 ]; then
  echo "No database files to remove"
fi

# ─── Optionally restart ─────────────────────────────────────────────────────────

if [ "${1:-}" = "--start" ]; then
  echo ""
  echo "=== Starting servers ==="

  cd "$ROOT_DIR"

  # Start server in background
  pnpm dev &
  SERVER_PID=$!
  echo "Server starting (pid $SERVER_PID)..."

  # Start UI in background
  pnpm dev:ui &
  UI_PID=$!
  echo "UI starting (pid $UI_PID)..."

  # Wait for server to be ready
  echo "Waiting for server health check..."
  for i in $(seq 1 15); do
    if curl -sf http://localhost:3000/health >/dev/null 2>&1; then
      echo "Server is healthy"
      break
    fi
    if [ "$i" -eq 15 ]; then
      echo "Warning: server did not become healthy in time"
    fi
    sleep 1
  done

  # Create a game
  echo ""
  echo "=== Creating game ==="
  curl -s -X POST http://localhost:3000/api/games \
    -H 'Content-Type: application/json' \
    -d '{"name":"Test Table","smallBlind":5,"bigBlind":10,"maxPlayers":6,"startingStack":1000}' \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Game created: {d[\"name\"]} ({d[\"id\"]})')" \
    2>/dev/null || echo "Warning: failed to create game"

  echo ""
  echo "=== Ready ==="
  echo "  Server:  http://localhost:3000"
  echo "  UI:      http://localhost:5173"
  echo "  API:     http://localhost:3000/api/games"
  echo ""
  echo "Press Ctrl+C to stop all servers"

  # Wait for either process to exit
  wait
else
  echo ""
  echo "Reset complete. Run with --start to also restart servers."
fi
