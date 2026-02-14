#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "[deploy] Checking current revision..."
old_rev=$(git rev-parse HEAD)

echo "[deploy] Pulling latest code..."
git pull --ff-only

new_rev=$(git rev-parse HEAD)

if [ "$old_rev" = "$new_rev" ]; then
  echo "[deploy] No new commits. Skipping build and restart."
  exit 0
fi

echo "[deploy] Changes detected ($old_rev -> $new_rev). Building images..."
docker compose build

echo "[deploy] Restarting stack..."
docker compose down
docker compose up -d --remove-orphans

echo "[deploy] Done! GREAT SUCCESS!!!"
