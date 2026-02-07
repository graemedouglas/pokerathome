# pokerathome

Self-hostable online poker for humans and robots.

## Project Structure

```
pokerathome/
  schema/         @pokerathome/schema   — Protocol spec, Zod types, docs
  server/         @pokerathome/server   — Game server (Fastify + WS + SQLite)
  ui/             @pokerathome/ui       — PixiJS game client (Vite)
  admin/          @pokerathome/admin    — Admin dashboard (Vite stub)
  e2e/            @pokerathome/e2e      — End-to-end Playwright tests
  python-bot/                           — Example Python bot
  scripts/                              — Dev utility scripts (bash + PowerShell)
```

## Getting Started

```bash
# Install dependencies (review package.json files first)
pnpm install

# Build the schema package (dependency of server and ui)
pnpm --filter @pokerathome/schema build

# Start the server
pnpm dev

# Create a game via the admin API (server must be running)
curl -X POST http://localhost:3000/api/games \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Table","smallBlind":5,"bigBlind":10,"maxPlayers":6,"startingStack":1000}'

# Start the UI (separate terminal)
pnpm dev:ui
```

Or use the reset script to do it all in one shot:

```bash
# Kill any running servers, wipe the DB, restart everything, and create a game
pnpm reset:start
```

The server runs on `http://localhost:3000` with:
- WebSocket endpoint at `ws://localhost:3000/ws`
- Admin REST API at `http://localhost:3000/api/games`
- Health check at `http://localhost:3000/health`

The UI runs on `http://localhost:5173` (proxies WebSocket to the server via Vite).

### Creating games

Games are created through the admin REST API while the server is running:

```bash
curl -X POST http://localhost:3000/api/games \
  -H 'Content-Type: application/json' \
  -d '{"name":"My Table","smallBlind":5,"bigBlind":10,"maxPlayers":6,"startingStack":1000}'
```

There is also a CLI script that writes directly to the database (server must **not** be running):

```bash
pnpm --filter @pokerathome/server create-game --name "My Table" --blinds 5/10 --stack 1000 --seats 6
```

## Testing

### Unit tests

Engine tests covering the deck, pot calculation, game state machine, and action validation:

```bash
pnpm test
```

### End-to-end tests

The e2e suite uses Playwright to spin up two headless browser tabs, walk through the full lobby flow (identify, join game, ready up), and verify the game starts and renders on a PixiJS canvas. Screenshots are saved to `e2e/screenshots/`.

```bash
# Prerequisites: server and UI must be running, and at least one game must exist.
# The test creates its own game via the admin API, so just start the servers:
pnpm dev      # terminal 1
pnpm dev:ui   # terminal 2

# Run the test
pnpm e2e
```

Playwright browsers need to be installed once:

```bash
npx playwright install chromium
```

## Scripts

Utility scripts live in `scripts/` with both bash and PowerShell variants.

| Script | Bash | PowerShell | Description |
|--------|------|------------|-------------|
| Kill dev servers | `scripts/kill-dev.sh` | `scripts/kill-dev.ps1` | Kills processes on ports 3000 and 5173 |
| Reset | `scripts/reset.sh` | `scripts/reset.ps1` | Kill servers + delete database files |
| Reset & start | `scripts/reset.sh --start` | `scripts/reset.ps1 -Start` | Reset + restart servers + create a game |

npm script shortcuts:

```bash
pnpm kill          # kill dev servers
pnpm reset         # kill + wipe DB
pnpm reset:start   # kill + wipe DB + restart + create game
```

## Documentation

- [Protocol Reference](schema/PROTOCOL.md) — Full WebSocket message protocol for bot builders
- [Protocol Spec](schema/SPEC.md) — High-level requirements and design notes
- [AsyncAPI Schema](schema/poker-protocol.asyncapi.yaml) — Machine-readable protocol definition
